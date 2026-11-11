import type { DeployOutcome, DestroyOutcome, StackEventView } from "./deploy.js";

/** 132 桁の連続帳票（ライン・プリンター風）。UI 層: 判断は持たず、結果を印字するだけ。 */
const WIDTH = 132;
const RULE = "*".repeat(WIDTH);

function line(text: string): string {
  return text.length > WIDTH ? text.slice(0, WIDTH) : text;
}

/** 132 桁を超える行は切り捨てず折り返す（失敗理由は末尾に原因が来ることが多い）。 */
function wrap(text: string, indent: string): string[] {
  const width = WIDTH - indent.length;
  const out: string[] = [];
  for (let i = 0; i < text.length || i === 0; i += width) out.push(`${i === 0 ? indent : " ".repeat(indent.length)}${text.slice(i, i + width)}`);
  return out;
}

export function header(title: string, stackName: string, region: string): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return [RULE, line(`* ${title}   STACK=${stackName}   REGION=${region}   RUN=${now}Z`.padEnd(WIDTH - 1) + "*"), RULE].join("\n");
}

export function eventLine(e: StackEventView): string {
  const time = e.time.toISOString().slice(11, 19);
  const reason = e.reason ? `  ${e.reason}` : "";
  return line(`${time}  ${e.status.padEnd(26)} ${e.logicalId.padEnd(24)} ${e.type}${reason}`);
}

function abend(title: string, rows: string[]): string {
  return [
    RULE,
    line(`*** ABEND S0C7 *** ${title}`),
    ...rows.flatMap((r) => wrap(r, "    ")),
    RULE,
  ].join("\n");
}

/** 終了コードも決める。0 のみ成功。 */
export function renderDeploy(o: DeployOutcome): { text: string; code: number } {
  switch (o.kind) {
    case "ok":
      return { text: `${RULE}\n* DEPLOY COMPLETE   ${o.stackStatus}\n${RULE}`, code: 0 };
    case "no-changes":
      return { text: `${RULE}\n* NO CHANGES — STACK ALREADY UP TO DATE\n${RULE}`, code: 0 };
    case "changeset-rejected":
      return { text: abend("CHANGESET REJECTED", [o.reason]), code: 1 };
    case "stack-failed":
      return {
        text: abend(
          "STACK FAILED",
          [
            ...o.failures.map((f) => `${f.logicalId} (${f.type}): ${f.reason}`),
            ...(o.rollback === "restored" ? ["ROLLBACK — PRIOR STATE RESTORED"] : []),
            ...(o.rollback === "failed"
              ? [`ROLLBACK FAILED (${o.stackStatus}) — STATE NOT RESTORED. MANUAL CLEANUP REQUIRED`]
              : []),
          ],
        ),
        code: 1,
      };
    case "stack-unusable":
      return { text: abend(`STACK ${o.stackStatus}`, [o.advice]), code: 1 };
    case "no-credentials":
      return { text: abend("SECURITY VIOLATION — NO VALID CREDENTIALS", [`(${o.detail})`]), code: 1 };
    case "aws-error":
      return { text: abend("AWS ERROR", [o.detail]), code: 1 };
  }
}

export function renderDestroy(o: DestroyOutcome): { text: string; code: number } {
  switch (o.kind) {
    case "ok":
      return { text: `${RULE}\n* DESTROY COMPLETE\n${RULE}`, code: 0 };
    case "not-found":
      return { text: `${RULE}\n* STACK NOT FOUND — NOTHING TO DESTROY\n${RULE}`, code: 0 };
    case "failed":
      return {
        text: abend("DELETE FAILED", o.failures.map((f) => `${f.logicalId} (${f.type}): ${f.reason}`)),
        code: 1,
      };
    case "no-credentials":
      return { text: abend("SECURITY VIOLATION — NO VALID CREDENTIALS", [`(${o.detail})`]), code: 1 };
    case "aws-error":
      return { text: abend("AWS ERROR", [o.detail]), code: 1 };
  }
}
