import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { CobolError, KNOWN_ERROR_CODES, formatError, formatWarning, messageId } from "../src/errors.js";
import { Ledger } from "../src/report.js";

function cards(...rows: string[]): string {
  return rows.map((r, i) => `${String((i + 1) * 100).padStart(6, "0")} ${r}`).join("\n");
}

describe("メッセージ番号（パロディ）", () => {
  it("src で投げているエラーコードはすべて番号表に載っている", () => {
    const used = new Set<string>();
    const files = [...readdirSync(join(import.meta.dirname, "..", "src")).filter((n) => n.endsWith(".ts")).map((n) => join("src", n)), ...readdirSync(join(import.meta.dirname, "..", "src", "mapping")).map((n) => join("src", "mapping", n))];
    for (const f of files) {
      const text = readFileSync(join(import.meta.dirname, "..", f), "utf8");
      for (const m of text.matchAll(/new CobolError\(\s*"([A-Z0-9-]+)"/g)) used.add(m[1] as string);
      for (const m of text.matchAll(/code:\s*"([A-Z0-9-]+)"/g)) used.add(m[1] as string); // 警告
      for (const m of text.matchAll(/\b(?:warn|fail)\(\s*"([A-Z0-9-]+)"/g)) used.add(m[1] as string); // 対応表のフック／エンジン
    }
    const missing = [...used].filter((c) => !KNOWN_ERROR_CODES.includes(c));
    expect(missing, `番号表に無いコード: ${missing.join(", ")}`).toEqual([]);
  });

  it("番号は一意で、実在の IBM メッセージ ID（IGY など）を使わない", () => {
    const ids = KNOWN_ERROR_CODES.map((c) => messageId(c));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^CBF-\d{4}-[SW]$/);
      expect(id).not.toMatch(/^IGY|^IEF|^CEE/);
    }
  });

  it("エラーは SEVERITY 12、警告は SEVERITY 4 で行・桁つきに整形される", () => {
    const e = new CobolError("INVALID-INDICATOR", "桁ずれ", 3, 7);
    expect(formatError("a.cbl", e)).toMatch(/^a\.cbl:3:7: CBF-\d{4}-S SEVERITY 12: 桁ずれ \[INVALID-INDICATOR\]$/);
    expect(formatWarning("a.cbl", { code: "MISSING-STOP-RUN", message: "x", line: 9 })).toMatch(
      /^a\.cbl:9: CBF-\d{4}-W SEVERITY 4: x \[MISSING-STOP-RUN\]$/,
    );
  });

  it("小文字には決め台詞がつく", () => {
    try {
      compile(cards("identification division."));
      throw new Error("エラーになるはず");
    } catch (e) {
      expect(e).toBeInstanceOf(CobolError);
      expect(formatError("a.cbl", e as CobolError)).toContain("LOWERCASE IS HERESY");
    }
  });
});

describe("--strict-sequence", () => {
  const body = [
    "000100 IDENTIFICATION DIVISION.",
    "000300 PROGRAM-ID. T.",
    "000200 PROCEDURE DIVISION.",
    "000400     STOP RUN.",
  ].join("\n");

  it("連番が乱れていても、指定しなければ通る", () => {
    expect(() => compile(body)).not.toThrow();
  });

  it("指定すると、昇順でない連番をエラーにする（行・桁つき）", () => {
    try {
      compile(body, { strictSequence: true });
      throw new Error("エラーになるはず");
    } catch (e) {
      expect(e).toBeInstanceOf(CobolError);
      const err = e as CobolError;
      expect(err.code).toBe("SEQUENCE-ERROR");
      expect(err.line).toBe(3);
      expect(err.col).toBe(1);
      expect(formatError("a.cbl", err)).toContain("CARD DECK IS OUT OF ORDER");
    }
  });

  it("同じ連番の重複もエラー", () => {
    const dup = ["000100 IDENTIFICATION DIVISION.", "000100 PROGRAM-ID. T."].join("\n");
    expect(() => compile(dup, { strictSequence: true })).toThrow(/ソーター/);
  });

  it("連番が空の行は無視する（連番は任意）", () => {
    const blank = ["       IDENTIFICATION DIVISION.", "       PROGRAM-ID. T.", "       PROCEDURE DIVISION.", "           STOP RUN."].join("\n");
    expect(() => compile(blank, { strictSequence: true })).not.toThrow();
  });
});

describe("STOP RUN 忘れ", () => {
  const head = ["IDENTIFICATION DIVISION.", "PROGRAM-ID. T."];

  it("PROCEDURE があって STOP RUN も GOBACK も無いと警告する", () => {
    const r = compile(cards(...head, "PROCEDURE DIVISION.", "MAIN-PARA.", '    CALL "DEPLOY".'));
    expect(r.warnings.some((w) => w.code === "MISSING-STOP-RUN")).toBe(true);
  });

  it("STOP RUN があれば警告しない", () => {
    const r = compile(cards(...head, "PROCEDURE DIVISION.", "MAIN-PARA.", '    CALL "DEPLOY".', "    STOP RUN."));
    expect(r.warnings.some((w) => w.code === "MISSING-STOP-RUN")).toBe(false);
  });

  it("GOBACK でも警告しない", () => {
    const r = compile(cards(...head, "PROCEDURE DIVISION.", "MAIN-PARA.", "    GOBACK."));
    expect(r.warnings.some((w) => w.code === "MISSING-STOP-RUN")).toBe(false);
  });

  it("PROCEDURE DIVISION 自体が無ければ警告しない", () => {
    const r = compile(cards(...head));
    expect(r.warnings.some((w) => w.code === "MISSING-STOP-RUN")).toBe(false);
  });
});

describe("連続帳票（Ledger）", () => {
  const ev = (status: string, logicalId: string, type = "AWS::S3::Bucket") => ({
    time: new Date("2026-11-11T00:00:00Z"),
    logicalId,
    type,
    status,
    reason: undefined,
  });

  it("ページ番号つきのヘッダで始まる", () => {
    const book = new Ledger("DEPLOY DIVISION", "S", "ap-northeast-1");
    expect(book.start()).toContain("PAGE 0001");
  });

  it("一定行ごとに改頁し、頁番号が増える", () => {
    const book = new Ledger("DEPLOY DIVISION", "S", "ap-northeast-1", 6);
    book.start();
    const out = Array.from({ length: 10 }, (_, i) => book.event(ev("CREATE_IN_PROGRESS", `R${i}`))).join("\n");
    expect(out).toContain("PAGE 0002");
  });

  it("全行が 132 桁以内", () => {
    const book = new Ledger("DEPLOY DIVISION", "A-VERY-LONG-STACK-NAME", "ap-northeast-1", 5);
    const text = [book.start(), ...Array.from({ length: 12 }, (_, i) => book.event(ev("CREATE_COMPLETE", `Res${i}`))), book.footer()].join("\n");
    for (const l of text.split("\n")) expect(l.length).toBeLessThanOrEqual(132);
  });

  it("合計は作成・更新・削除を論理 ID で数え、スタック自身は数えない", () => {
    const book = new Ledger("DEPLOY DIVISION", "S", "ap-northeast-1");
    book.event(ev("CREATE_COMPLETE", "A"));
    book.event(ev("CREATE_COMPLETE", "A")); // 同じリソースの重複は 1 つ
    book.event(ev("CREATE_COMPLETE", "B"));
    book.event(ev("UPDATE_COMPLETE", "C"));
    book.event(ev("DELETE_COMPLETE", "D"));
    book.event(ev("CREATE_COMPLETE", "S", "AWS::CloudFormation::Stack"));
    expect(book.footer()).toContain("TOTAL RESOURCES CREATED: 2   UPDATED: 1   DELETED: 1");
  });
});
