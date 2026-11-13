import type { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { describe, expect, it } from "vitest";
import { deploy, destroy, diff, isCredentialError, rollbackStateOf } from "../src/deploy.js";
import { renderDeploy, renderDiff } from "../src/report.js";

type Handler = (input: Record<string, unknown>) => unknown;

/** コマンド名ごとに応答を返す偽クライアント。実 AWS には触れない。 */
function fakeClient(handlers: Record<string, Handler>, calls: string[] = []): CloudFormationClient {
  return {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = cmd.constructor.name;
      calls.push(name);
      const h = handlers[name];
      if (!h) throw new Error(`想定外の呼び出し: ${name}`);
      return h(cmd.input);
    },
  } as unknown as CloudFormationClient;
}

const doesNotExist = () => {
  throw new Error("Stack with id X does not exist");
};

const base = { stackName: "X", region: "ap-northeast-1", pollMs: 0 };

describe("destroy", () => {
  it("削除完了でイベントが引けなくなっても成功として扱う", async () => {
    let described = 0;
    const client = fakeClient({
      DescribeStacksCommand: () => {
        described++;
        return { Stacks: [{ StackStatus: "DELETE_IN_PROGRESS" }] };
      },
      DescribeStackEventsCommand: () => {
        // 1 回目（既読化）は成功、以降は削除済みで失敗
        if (described <= 1) return { StackEvents: [] };
        return doesNotExist();
      },
      DeleteStackCommand: () => ({}),
    });
    expect(await destroy({ ...base, client })).toEqual({ kind: "ok" });
  });

  it("削除後は名前では引けないので、スタック ID でイベントを追い、最後の DELETE_COMPLETE も拾う", async () => {
    const refs: string[] = [];
    let phase = 0; // 0: 既読化 / 1: 途中 / 2: 削除完了後
    const ev = (id: string, logicalId: string, status: string) => ({
      EventId: id,
      LogicalResourceId: logicalId,
      ResourceType: "AWS::S3::Bucket",
      ResourceStatus: status,
      Timestamp: new Date(),
    });
    const client = fakeClient({
      DescribeStacksCommand: (input) => {
        const name = String(input["StackName"]);
        // 削除が済んだ後は名前では見つからないが、ID なら DELETE_COMPLETE が返る
        if (phase >= 2 && name === "X") return doesNotExist();
        return { Stacks: [{ StackId: "arn:stack/X/1", StackStatus: phase >= 2 ? "DELETE_COMPLETE" : "DELETE_IN_PROGRESS" }] };
      },
      DescribeStackEventsCommand: (input) => {
        const name = String(input["StackName"]);
        refs.push(name);
        if (phase >= 2 && name === "X") return doesNotExist();
        phase++;
        if (phase === 1) return { StackEvents: [] };
        return { StackEvents: [ev("2", "B", "DELETE_COMPLETE"), ev("1", "A", "DELETE_COMPLETE")] };
      },
      DeleteStackCommand: () => ({}),
    });
    const seen: string[] = [];
    const out = await destroy({ ...base, client, onEvent: (e) => seen.push(`${e.logicalId}:${e.status}`) });
    expect(out).toEqual({ kind: "ok" });
    expect(refs.every((r) => r === "arn:stack/X/1")).toBe(true);
    expect(seen).toEqual(["A:DELETE_COMPLETE", "B:DELETE_COMPLETE"]);
  });

  it("存在しないスタックは not-found（正常）", async () => {
    const client = fakeClient({ DescribeStacksCommand: doesNotExist });
    expect(await destroy({ ...base, client })).toEqual({ kind: "not-found" });
  });
});

describe("deploy", () => {
  const template = { Resources: { B: { Type: "AWS::S3::Bucket" } } };

  it("変更なしは no-changes で、作りかけの空スタックを消す", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {
        DescribeStacksCommand: doesNotExist,
        CreateChangeSetCommand: () => ({}),
        DescribeChangeSetCommand: () => ({ Status: "FAILED", StatusReason: "The submitted information didn't contain changes." }),
        DeleteChangeSetCommand: () => ({}),
        DeleteStackCommand: () => ({}),
      },
      calls,
    );
    expect(await deploy({ ...base, template, client })).toEqual({ kind: "no-changes" });
    expect(calls).toContain("DeleteStackCommand");
  });

  it("ChangeSet 失敗（変更なし以外）は理由つきで rejected", async () => {
    const client = fakeClient({
      DescribeStacksCommand: doesNotExist,
      CreateChangeSetCommand: () => ({}),
      DescribeChangeSetCommand: () => ({ Status: "FAILED", StatusReason: "Template format error" }),
      DeleteChangeSetCommand: () => ({}),
      DeleteStackCommand: () => ({}),
    });
    expect(await deploy({ ...base, template, client })).toEqual({
      kind: "changeset-rejected",
      reason: "Template format error",
    });
  });

  it("ROLLBACK_COMPLETE の残骸は更新せず削除を案内する", async () => {
    const client = fakeClient({
      DescribeStacksCommand: () => ({ Stacks: [{ StackStatus: "ROLLBACK_COMPLETE" }] }),
    });
    const out = await deploy({ ...base, template, client });
    expect(out.kind).toBe("stack-unusable");
  });

  it("失敗したリソースを抽出し、ロールバックを検知する", async () => {
    let status = "CREATE_IN_PROGRESS";
    const client = fakeClient({
      DescribeStacksCommand: (() => {
        let n = 0;
        return () => {
          n++;
          if (n === 1) return doesNotExist(); // 既存確認
          status = "ROLLBACK_COMPLETE";
          return { Stacks: [{ StackStatus: status }] };
        };
      })(),
      CreateChangeSetCommand: () => ({}),
      DescribeChangeSetCommand: () => ({ Status: "CREATE_COMPLETE" }),
      ExecuteChangeSetCommand: () => ({}),
      DescribeStackEventsCommand: () => ({
        StackEvents: [
          {
            EventId: "1",
            LogicalResourceId: "B",
            ResourceType: "AWS::S3::Bucket",
            ResourceStatus: "CREATE_FAILED",
            ResourceStatusReason: "boom",
          },
        ],
      }),
    });
    const out = await deploy({ ...base, template, client });
    expect(out).toMatchObject({ kind: "stack-failed", rollback: "restored" });
    if (out.kind === "stack-failed") expect(out.failures[0]?.reason).toBe("boom");
  });

  it("資格情報エラーは no-credentials に分類し、値を含めない", async () => {
    const err = new Error("secret detail");
    err.name = "CredentialsProviderError";
    const client = fakeClient({
      DescribeStacksCommand: () => {
        throw err;
      },
    });
    expect(await deploy({ ...base, template, client })).toEqual({ kind: "no-credentials", detail: "CredentialsProviderError" });
  });
});

describe("巻き戻しの判定（実機で ROLLBACK_FAILED を踏んで追加）", () => {
  it("ROLLBACK_COMPLETE 系だけが「元に戻った」", () => {
    expect(rollbackStateOf("ROLLBACK_COMPLETE")).toBe("restored");
    expect(rollbackStateOf("UPDATE_ROLLBACK_COMPLETE")).toBe("restored");
  });

  it("ROLLBACK_FAILED は元に戻っていない", () => {
    expect(rollbackStateOf("ROLLBACK_FAILED")).toBe("failed");
    expect(rollbackStateOf("UPDATE_ROLLBACK_FAILED")).toBe("failed");
  });

  it("巻き戻しでない失敗は none", () => {
    expect(rollbackStateOf("CREATE_FAILED")).toBe("none");
  });

  it("帳票は ROLLBACK_FAILED を「元に戻した」と表示しない", () => {
    const { text, code } = renderDeploy({
      kind: "stack-failed",
      stackStatus: "ROLLBACK_FAILED",
      rollback: "failed",
      failures: [{ logicalId: "BadBucket", type: "AWS::S3::Bucket", reason: "boom" }],
    });
    expect(code).toBe(1);
    expect(text).not.toContain("PRIOR STATE RESTORED");
    expect(text).toContain("MANUAL CLEANUP REQUIRED");
  });

  it("長い失敗理由は切り捨てず折り返す（132 桁以内）", () => {
    const reason = `${"x".repeat(200)}ROOT-CAUSE`;
    const { text } = renderDeploy({
      kind: "stack-failed",
      stackStatus: "ROLLBACK_COMPLETE",
      rollback: "restored",
      failures: [{ logicalId: "B", type: "AWS::S3::Bucket", reason }],
    });
    expect(text).toContain("ROOT-CAUSE");
    for (const l of text.split("\n")) expect(l.length).toBeLessThanOrEqual(132);
  });
});

describe("diff", () => {
  const template = { Resources: { B: { Type: "AWS::S3::Bucket" } } };

  it("既存スタックとの変更点を返し、ChangeSet を必ず消す（実行しない）", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {
        DescribeStacksCommand: () => ({ Stacks: [{ StackStatus: "CREATE_COMPLETE" }] }),
        CreateChangeSetCommand: () => ({}),
        DescribeChangeSetCommand: () => ({
          Status: "CREATE_COMPLETE",
          Changes: [{ ResourceChange: { Action: "Modify", LogicalResourceId: "B", ResourceType: "AWS::S3::Bucket", Replacement: "False" } }],
        }),
        DeleteChangeSetCommand: () => ({}),
      },
      calls,
    );
    const out = await diff({ ...base, template, client });
    expect(out).toEqual({
      kind: "changes",
      stackExists: true,
      changes: [{ action: "Modify", logicalId: "B", type: "AWS::S3::Bucket", replacement: "False" }],
    });
    expect(calls).toContain("DeleteChangeSetCommand");
    expect(calls).not.toContain("ExecuteChangeSetCommand");
    expect(calls).not.toContain("DeleteStackCommand"); // 既存スタックは消さない
  });

  it("スタックが無いときは新規作成として扱い、作りかけの空スタックを消す", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {
        DescribeStacksCommand: doesNotExist,
        CreateChangeSetCommand: () => ({}),
        DescribeChangeSetCommand: () => ({
          Status: "CREATE_COMPLETE",
          Changes: [{ ResourceChange: { Action: "Add", LogicalResourceId: "B", ResourceType: "AWS::S3::Bucket" } }],
        }),
        DeleteChangeSetCommand: () => ({}),
        DeleteStackCommand: () => ({}),
      },
      calls,
    );
    const out = await diff({ ...base, template, client });
    expect(out).toMatchObject({ kind: "changes", stackExists: false });
    expect(calls).toContain("DeleteStackCommand");
    expect(calls).not.toContain("ExecuteChangeSetCommand");
  });

  it("変更なしは no-changes で、拒否された ChangeSet も消す", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      {
        DescribeStacksCommand: () => ({ Stacks: [{ StackStatus: "CREATE_COMPLETE" }] }),
        CreateChangeSetCommand: () => ({}),
        DescribeChangeSetCommand: () => ({ Status: "FAILED", StatusReason: "The submitted information didn't contain changes." }),
        DeleteChangeSetCommand: () => ({}),
      },
      calls,
    );
    expect(await diff({ ...base, template, client })).toEqual({ kind: "no-changes", stackExists: true });
    expect(calls).toContain("DeleteChangeSetCommand");
  });

  it("置き換えが起きる変更は、データ消失の注意を帳票に出す", () => {
    const { text, code } = renderDiff({
      kind: "changes",
      stackExists: true,
      changes: [{ action: "Modify", logicalId: "T", type: "AWS::DynamoDB::GlobalTable", replacement: "True" }],
    });
    expect(code).toBe(0);
    expect(text).toContain("DATA MAY BE LOST");
  });
});

describe("isCredentialError", () => {
  it("期限切れトークンを認証エラーと判定する", () => {
    const e = new Error("x");
    e.name = "ExpiredToken";
    expect(isCredentialError(e)).toBe(true);
    expect(isCredentialError(new Error("other"))).toBe(false);
  });
});
