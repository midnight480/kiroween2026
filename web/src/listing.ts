import { compile } from "../../src/compile.js";
import { CobolError, formatError, formatWarning } from "../../src/errors.js";
import { toYaml } from "../../src/yaml.js";

/** 帳票 1 行。cls は見た目の指定だけで、意味の判断は含まない。 */
export type LineClass = "rule" | "normal" | "warn" | "blood" | "ghost";

export interface ListingLine {
  text: string;
  cls: LineClass;
}

export interface Listing {
  lines: ListingLine[];
  ok: boolean;
}

export const WIDTH = 132;
const RULE = "*".repeat(WIDTH);

function boxed(text: string): string {
  return `* ${text}`.padEnd(WIDTH - 1) + "*";
}

/** 132 桁を超える行は折り返す（切り捨てない）。 */
function wrap(text: string, indent = "    "): string[] {
  const width = WIDTH - indent.length;
  const out: string[] = [];
  for (let i = 0; i < Math.max(text.length, 1); i += width) {
    out.push(`${i === 0 ? indent : " ".repeat(indent.length)}${text.slice(i, i + width)}`);
  }
  return out;
}

/** `ASSIGN TO "DBLINK"` で出る 8i の亡霊（3+1 台のサーバー）。 */
const GHOST = [
  "      .-.        .-.        .-.        .-.",
  "     (o o)      (o o)      (o o)      (o o)     <- 3 + 1 SERVERS, LINKED BY HAND",
  "     | O |======| O |======| O |======| O |",
  "     '~~~'      '~~~'      '~~~'      '~~~'",
  "      DB1        DB2        DB3      (STANDBY)",
  "     THE ERA OF DB-LINK REDUNDANCY IS OVER. USE DYNAMODB-MRSC.",
];

/**
 * ソースを検査して、ラインプリンターに印字する帳票を作る。
 * ブラウザでも Node でも動く純粋関数（時刻は引数で受け取る）。
 */
export function buildListing(source: string, file = "PROGRAM.CBL", now = new Date()): Listing {
  const stamp = now.toISOString().replace("T", " ").slice(0, 19);
  const lines: ListingLine[] = [];
  const push = (text: string, cls: LineClass = "normal"): void => {
    lines.push({ text, cls });
  };

  try {
    const result = compile(source);
    const resources = result.template["Resources"] as Record<string, { Type: string }>;
    const ids = Object.keys(resources);

    push(RULE, "rule");
    push(boxed(`COBOLFORM COMPILE LISTING   PROGRAM=${result.stackName}   REGION=${result.region ?? "(none)"}   RUN=${stamp}Z`), "rule");
    push(RULE, "rule");

    for (const w of result.warnings) for (const l of wrap(formatWarning(file, w), "  ")) push(l, "warn");
    if (result.warnings.length > 0) push("");

    push("  RESOURCES");
    for (const id of ids) push(`    ${id.padEnd(28)} ${(resources[id] as { Type: string }).Type}`);
    push("");
    push("  CLOUDFORMATION");
    for (const l of toYaml(result.template).split("\n")) if (l !== "") for (const w of wrap(l, "    ")) push(w);
    push("");
    push(RULE, "rule");
    push(boxed(`TOTAL RESOURCES: ${ids.length}   WARNINGS: ${result.warnings.length}   INTENT: ${result.intent ?? "COMPILE"}`), "rule");
    push(RULE, "rule");
    return { lines, ok: true };
  } catch (e) {
    if (!(e instanceof CobolError)) throw e;
    push(RULE, "blood");
    push(`*** ABEND S0C7 *** COMPILE FAILED   PROGRAM=${file}   RUN=${stamp}Z`, "blood");
    for (const l of wrap(formatError(file, e))) push(l, "blood");
    if (e.code === "DBLINK-RETIRED") {
      push("");
      for (const g of GHOST) push(g, "ghost");
    }
    push(RULE, "blood");
    return { lines, ok: false };
  }
}
