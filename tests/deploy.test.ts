import type { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { describe, expect, it } from "vitest";
import { deploy, destroy, isCredentialError } from "../src/deploy.js";

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
    expect(out).toMatchObject({ kind: "stack-failed", rolledBack: true });
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

describe("isCredentialError", () => {
  it("期限切れトークンを認証エラーと判定する", () => {
    const e = new Error("x");
    e.name = "ExpiredToken";
    expect(isCredentialError(e)).toBe(true);
    expect(isCredentialError(new Error("other"))).toBe(false);
  });
});
