import { CobolError } from "./errors.js";
import type { DataItem, Literal, Program } from "./parser.js";

/** `LOGS-BUCKET` → `LogsBucket`（§4.4） */
export function pascalCase(name: string): string {
  return name
    .split("-")
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join("");
}

export function walk(items: DataItem[], fn: (item: DataItem) => void): void {
  for (const item of items) {
    fn(item);
    walk(item.children, fn);
  }
}

/** MOVE を反映した実効値。添字 n の要素は moved[n] ?? VALUE。 */
export function effectiveValue(item: DataItem, index = 0): Literal | undefined {
  return item.moved.get(index) ?? item.value;
}

export function child(group: DataItem, name: string): DataItem | undefined {
  return group.children.find((c) => c.name === name);
}

function occursAncestor(item: DataItem): DataItem | undefined {
  for (let p = item.parent; p; p = p.parent) if (p.occurs !== undefined) return p;
  return undefined;
}

function checkOverflow(item: DataItem, value: Literal, line: number, col: number): void {
  if (item.pic && typeof value === "string" && item.pic.kind === "X" && value.length > item.pic.length) {
    throw new CobolError(
      "PIC-OVERFLOW",
      `${item.name} は PIC X(${item.pic.length}) ですが、値が ${value.length} 文字あります`,
      line,
      col,
    );
  }
  if (item.pic && typeof value === "number" && item.pic.kind === "9" && String(value).length > item.pic.length) {
    throw new CobolError(
      "PIC-OVERFLOW",
      `${item.name} は PIC 9(${item.pic.length}) ですが、値 ${value} は桁あふれします`,
      line,
      col,
    );
  }
}

/** VALUE の桁あふれ検査と、PROCEDURE の MOVE の静的適用（§4.8）。 */
export function applyProcedure(program: Program): void {
  const all: DataItem[] = [];
  walk(program.workingStorage, (i) => all.push(i));
  for (const fd of program.fds) walk(fd.record, (i) => all.push(i));

  for (const item of all) {
    if (item.value !== undefined) checkOverflow(item, item.value, item.line, item.col);
  }

  for (const stmt of program.procedure) {
    if (stmt.kind !== "move") continue;

    const matches = all.filter((i) => i.name === stmt.target);
    if (matches.length === 0) {
      throw new CobolError("UNDEFINED-NAME", `MOVE の転送先 ${stmt.target} が定義されていません`, stmt.line, stmt.col);
    }
    if (matches.length > 1) {
      throw new CobolError("AMBIGUOUS-NAME", `${stmt.target} が複数定義されています`, stmt.line, stmt.col);
    }
    const target = matches[0] as DataItem;
    const arr = occursAncestor(target);

    if (arr) {
      if (stmt.subscript === undefined) {
        throw new CobolError("SUBSCRIPT-REQUIRED", `${stmt.target} は OCCURS 配下なので添字が必要です`, stmt.line, stmt.col);
      }
      const max = arr.occurs as number;
      if (stmt.subscript < 1 || stmt.subscript > max) {
        throw new CobolError(
          "SUBSCRIPT-OUT-OF-RANGE",
          `${stmt.target} (${stmt.subscript}) は範囲外です（1〜${max}）`,
          stmt.line,
          stmt.col,
        );
      }
      checkOverflow(target, stmt.value, stmt.line, stmt.col);
      target.moved.set(stmt.subscript, stmt.value); // 複数 MOVE は最後が勝つ
    } else {
      if (stmt.subscript !== undefined) {
        throw new CobolError("SUBSCRIPT-NOT-ALLOWED", `${stmt.target} は OCCURS ではないので添字は使えません`, stmt.line, stmt.col);
      }
      checkOverflow(target, stmt.value, stmt.line, stmt.col);
      target.moved.set(0, stmt.value);
    }
  }
}

/** OBJECT-COMPUTER `AWS-AP-NORTHEAST-1` → `ap-northeast-1`（§4.3） */
export function regionFromComputer(name: string, line: number): string {
  const m = /^AWS-([A-Z]+(?:-[A-Z]+)*-\d+)$/.exec(name);
  if (!m) {
    throw new CobolError(
      "INVALID-REGION",
      `OBJECT-COMPUTER はリージョン名（例: AWS-AP-NORTHEAST-1）で指定してください: ${name}`,
      line,
      8,
    );
  }
  return (m[1] as string).toLowerCase();
}
