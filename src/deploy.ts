import {
  CloudFormationClient,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DeleteStackCommand,
  DescribeChangeSetCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  type StackEvent,
} from "@aws-sdk/client-cloudformation";
import type { JsonObject } from "./emit.js";

/**
 * デプロイのロジック層（§4.6）。UI は持たず、結果と終了種別だけを返す。
 * 表示は呼び出し側が `onEvent` で受けたイベントと `DeployOutcome` から行う。
 */
export type DeployOutcome =
  | { kind: "ok"; stackStatus: string }
  | { kind: "no-changes" }
  | { kind: "changeset-rejected"; reason: string }
  | { kind: "stack-failed"; stackStatus: string; failures: FailedResource[]; rollback: RollbackState }
  | { kind: "stack-unusable"; stackStatus: string; advice: string }
  | { kind: "no-credentials"; detail: string }
  | { kind: "aws-error"; detail: string };

/**
 * 巻き戻しの結果。`restored` は ROLLBACK_COMPLETE 系だけ。
 * ROLLBACK_FAILED は元に戻っていないので `failed`（手動の後片付けが要る）。
 */
export type RollbackState = "none" | "restored" | "failed";

export function rollbackStateOf(status: string): RollbackState {
  if (status === "ROLLBACK_COMPLETE" || status === "UPDATE_ROLLBACK_COMPLETE") return "restored";
  if (/ROLLBACK_FAILED$/.test(status)) return "failed";
  return "none";
}

export interface FailedResource {
  logicalId: string;
  type: string;
  reason: string;
}

export interface StackEventView {
  time: Date;
  logicalId: string;
  type: string;
  status: string;
  reason: string | undefined;
}

export interface DeployOptions {
  stackName: string;
  region: string;
  template: JsonObject;
  onEvent?: (e: StackEventView) => void;
  /** テスト用に差し替え可能 */
  client?: CloudFormationClient;
  pollMs?: number;
}

const IN_PROGRESS = /_IN_PROGRESS$/;

function view(e: StackEvent): StackEventView {
  return {
    time: e.Timestamp ?? new Date(),
    logicalId: e.LogicalResourceId ?? "?",
    type: e.ResourceType ?? "?",
    status: e.ResourceStatus ?? "?",
    reason: e.ResourceStatusReason,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** SDK の資格情報解決エラーを分類する。鍵の値は決して扱わない。 */
export function isCredentialError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : "";
  return /CredentialsProviderError|TokenProviderError|ExpiredToken|InvalidClientTokenId|UnrecognizedClientException|SignatureDoesNotMatch|AuthFailure/.test(
    name,
  );
}

function needsIam(template: JsonObject): boolean {
  const resources = (template["Resources"] ?? {}) as Record<string, { Type?: string }>;
  return Object.values(resources).some((r) => typeof r.Type === "string" && r.Type.startsWith("AWS::IAM::"));
}

async function stackStatus(client: CloudFormationClient, name: string): Promise<string | undefined> {
  try {
    const r = await client.send(new DescribeStacksCommand({ StackName: name }));
    return r.Stacks?.[0]?.StackStatus;
  } catch (e) {
    if (e instanceof Error && /does not exist/.test(e.message)) return undefined;
    throw e;
  }
}

/** 新規イベント（古い順）を取り出す。 */
async function newEvents(client: CloudFormationClient, name: string, seen: Set<string>): Promise<StackEvent[]> {
  const r = await client.send(new DescribeStackEventsCommand({ StackName: name }));
  const fresh = (r.StackEvents ?? []).filter((e) => e.EventId && !seen.has(e.EventId));
  for (const e of fresh) seen.add(e.EventId as string);
  return fresh.reverse();
}

export async function deploy(opts: DeployOptions): Promise<DeployOutcome> {
  const client = opts.client ?? new CloudFormationClient({ region: opts.region });
  const pollMs = opts.pollMs ?? 3000;
  const { stackName } = opts;

  try {
    const existing = await stackStatus(client, stackName);

    // 作成に失敗して残ったスタックは更新できない。削除を促す（§4.6）
    if (existing === "REVIEW_IN_PROGRESS" || existing === "ROLLBACK_COMPLETE" || existing === "ROLLBACK_FAILED" || existing === "DELETE_FAILED") {
      return {
        kind: "stack-unusable",
        stackStatus: existing,
        advice: `スタック ${stackName} は ${existing} です。cobf destroy で削除してからやり直してください`,
      };
    }
    if (existing !== undefined && IN_PROGRESS.test(existing)) {
      return { kind: "stack-unusable", stackStatus: existing, advice: `スタック ${stackName} は ${existing} です。完了してから再実行してください` };
    }

    const type = existing === undefined ? "CREATE" : "UPDATE";
    const changeSetName = `cobolform-${Date.now()}`;

    // 既存イベントは既読にして、これ以降だけ報告する
    const seen = new Set<string>();
    if (existing !== undefined) await newEvents(client, stackName, seen);

    await client.send(
      new CreateChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
        ChangeSetType: type,
        TemplateBody: JSON.stringify(opts.template),
        Capabilities: needsIam(opts.template) ? ["CAPABILITY_IAM"] : [],
      }),
    );

    // ChangeSet の作成完了を待つ
    for (;;) {
      const cs = await client.send(new DescribeChangeSetCommand({ StackName: stackName, ChangeSetName: changeSetName }));
      if (cs.Status === "CREATE_COMPLETE") break;
      if (cs.Status === "FAILED") {
        const reason = cs.StatusReason ?? "";
        await client.send(new DeleteChangeSetCommand({ StackName: stackName, ChangeSetName: changeSetName })).catch(() => undefined);
        if (type === "CREATE") {
          // 空の ChangeSet で REVIEW_IN_PROGRESS のスタックが残るので消す
          await client.send(new DeleteStackCommand({ StackName: stackName })).catch(() => undefined);
        }
        if (/didn't contain changes|No updates/i.test(reason)) return { kind: "no-changes" };
        return { kind: "changeset-rejected", reason };
      }
      await sleep(pollMs);
    }

    await client.send(new ExecuteChangeSetCommand({ StackName: stackName, ChangeSetName: changeSetName }));

    // スタックが終了状態になるまでイベントを流す
    let status = "";
    for (;;) {
      for (const e of await newEvents(client, stackName, seen)) opts.onEvent?.(view(e));
      status = (await stackStatus(client, stackName)) ?? "";
      if (status !== "" && !IN_PROGRESS.test(status)) break;
      await sleep(pollMs);
    }
    for (const e of await newEvents(client, stackName, seen)) opts.onEvent?.(view(e));

    if (status === "CREATE_COMPLETE" || status === "UPDATE_COMPLETE") return { kind: "ok", stackStatus: status };

    // 失敗: 失敗イベントを抽出する
    const all = await client.send(new DescribeStackEventsCommand({ StackName: stackName }));
    const failures: FailedResource[] = (all.StackEvents ?? [])
      .filter((e) => /_FAILED$/.test(e.ResourceStatus ?? "") && e.ResourceType !== "AWS::CloudFormation::Stack")
      .reverse()
      .map((e) => ({
        logicalId: e.LogicalResourceId ?? "?",
        type: e.ResourceType ?? "?",
        reason: e.ResourceStatusReason ?? "",
      }));
    return { kind: "stack-failed", stackStatus: status, failures, rollback: rollbackStateOf(status) };
  } catch (e) {
    return classify(e);
  }
}

export type DestroyOutcome =
  | { kind: "ok" }
  | { kind: "not-found" }
  | { kind: "failed"; stackStatus: string; failures: FailedResource[] }
  | { kind: "no-credentials"; detail: string }
  | { kind: "aws-error"; detail: string };

export async function destroy(opts: Omit<DeployOptions, "template">): Promise<DestroyOutcome> {
  const client = opts.client ?? new CloudFormationClient({ region: opts.region });
  const pollMs = opts.pollMs ?? 3000;
  const { stackName } = opts;

  try {
    const existing = await stackStatus(client, stackName);
    if (existing === undefined) return { kind: "not-found" };

    const seen = new Set<string>();
    await newEvents(client, stackName, seen);
    await client.send(new DeleteStackCommand({ StackName: stackName }));

    for (;;) {
      // 削除が完了するとスタック名でイベントを引けなくなる。それは失敗ではなく完了の合図
      try {
        for (const e of await newEvents(client, stackName, seen)) opts.onEvent?.(view(e));
      } catch (e) {
        if (e instanceof Error && /does not exist/.test(e.message)) return { kind: "ok" };
        throw e;
      }
      const status = await stackStatus(client, stackName);
      if (status === undefined || status === "DELETE_COMPLETE") return { kind: "ok" };
      if (status === "DELETE_FAILED") {
        const all = await client.send(new DescribeStackEventsCommand({ StackName: stackName }));
        const failures = (all.StackEvents ?? [])
          .filter((e) => e.ResourceStatus === "DELETE_FAILED" && e.ResourceType !== "AWS::CloudFormation::Stack")
          .map((e) => ({ logicalId: e.LogicalResourceId ?? "?", type: e.ResourceType ?? "?", reason: e.ResourceStatusReason ?? "" }));
        return { kind: "failed", stackStatus: status, failures };
      }
      await sleep(pollMs);
    }
  } catch (e) {
    const c = classify(e);
    if (c.kind === "no-credentials") return c;
    return { kind: "aws-error", detail: e instanceof Error ? e.message : String(e) };
  }
}

function classify(e: unknown): { kind: "no-credentials"; detail: string } | { kind: "aws-error"; detail: string } {
  if (isCredentialError(e)) {
    // 資格情報の中身は出さない。エラー名だけを返す
    return { kind: "no-credentials", detail: e instanceof Error ? e.name : "CredentialsError" };
  }
  return { kind: "aws-error", detail: e instanceof Error ? e.message : String(e) };
}

// ---------------------------------------------------------------- diff

export interface ChangeView {
  action: string;
  logicalId: string;
  type: string;
  /** "True" | "False" | "Conditional" | undefined */
  replacement: string | undefined;
}

export type DiffOutcome =
  | { kind: "changes"; stackExists: boolean; changes: ChangeView[] }
  | { kind: "no-changes"; stackExists: boolean }
  | { kind: "changeset-rejected"; reason: string }
  | { kind: "stack-unusable"; stackStatus: string; advice: string }
  | { kind: "no-credentials"; detail: string }
  | { kind: "aws-error"; detail: string };

/**
 * 既存スタックとの差分を ChangeSet で調べる。実行はせず、必ず ChangeSet を消す。
 * スタックが無いときは新規作成として扱い、作りかけの REVIEW_IN_PROGRESS スタックも消す。
 */
export async function diff(opts: Omit<DeployOptions, "onEvent">): Promise<DiffOutcome> {
  const client = opts.client ?? new CloudFormationClient({ region: opts.region });
  const pollMs = opts.pollMs ?? 2000;
  const { stackName } = opts;

  try {
    const existing = await stackStatus(client, stackName);
    if (existing !== undefined && /^(REVIEW_IN_PROGRESS|ROLLBACK_COMPLETE|ROLLBACK_FAILED|DELETE_FAILED)$|_IN_PROGRESS$/.test(existing)) {
      return { kind: "stack-unusable", stackStatus: existing, advice: `スタック ${stackName} は ${existing} です。比較できません` };
    }

    const stackExists = existing !== undefined;
    const changeSetName = `cobolform-diff-${Date.now()}`;
    await client.send(
      new CreateChangeSetCommand({
        StackName: stackName,
        ChangeSetName: changeSetName,
        ChangeSetType: stackExists ? "UPDATE" : "CREATE",
        TemplateBody: JSON.stringify(opts.template),
        Capabilities: needsIam(opts.template) ? ["CAPABILITY_IAM"] : [],
      }),
    );

    const cleanup = async (): Promise<void> => {
      await client.send(new DeleteChangeSetCommand({ StackName: stackName, ChangeSetName: changeSetName })).catch(() => undefined);
      // 新規作成の確認で作られた空のスタックを残さない
      if (!stackExists) await client.send(new DeleteStackCommand({ StackName: stackName })).catch(() => undefined);
    };

    try {
      for (;;) {
        const cs = await client.send(new DescribeChangeSetCommand({ StackName: stackName, ChangeSetName: changeSetName }));
        if (cs.Status === "CREATE_COMPLETE") {
          const changes: ChangeView[] = (cs.Changes ?? []).map((c) => ({
            action: c.ResourceChange?.Action ?? "?",
            logicalId: c.ResourceChange?.LogicalResourceId ?? "?",
            type: c.ResourceChange?.ResourceType ?? "?",
            replacement: c.ResourceChange?.Replacement,
          }));
          return changes.length === 0 ? { kind: "no-changes", stackExists } : { kind: "changes", stackExists, changes };
        }
        if (cs.Status === "FAILED") {
          const reason = cs.StatusReason ?? "";
          if (/didn't contain changes|No updates/i.test(reason)) return { kind: "no-changes", stackExists };
          return { kind: "changeset-rejected", reason };
        }
        await sleep(pollMs);
      }
    } finally {
      await cleanup();
    }
  } catch (e) {
    return classify(e);
  }
}
