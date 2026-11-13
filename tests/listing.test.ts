import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildListing, WIDTH, wrap } from "../web/src/listing.js";

const NOW = new Date("2026-11-13T00:00:00Z");
const golden = (name: string): string => readFileSync(join(import.meta.dirname, "golden", name, "input.cbl"), "utf8");

describe("ブラウザ用の帳票（buildListing）", () => {
  it("正常なソースは緑のインクで、リソース一覧と合計を出す", () => {
    const r = buildListing(golden("lambda"), "T.CBL", NOW);
    const text = r.lines.map((l) => l.text).join("\n");
    expect(r.ok).toBe(true);
    expect(text).toContain("FnRole");
    expect(text).toContain("AWS::Lambda::Function");
    expect(text).toContain("TOTAL RESOURCES: 2");
    expect(r.lines.some((l) => l.cls === "blood")).toBe(false);
  });

  it("全行が 132 桁以内に収まる（長い ARN や ZipFile も折り返す）", () => {
    for (const name of ["s3", "lambda", "policy-ref", "db-mrsc", "three-tier", "edge", "classic"]) {
      for (const l of buildListing(golden(name), "T.CBL", NOW).lines) {
        expect(l.text.length, `${name}: ${l.text}`).toBeLessThanOrEqual(WIDTH);
      }
    }
  });

  it("エラーは血のインクで、行・桁・番号つきに出す", () => {
    const r = buildListing("000100IDENTIFICATION DIVISION.", "T.CBL", NOW);
    const text = r.lines.map((l) => l.text).join("\n");
    expect(r.ok).toBe(false);
    expect(text).toContain("T.CBL:1:7");
    expect(text).toMatch(/CBF-\d{4}-S SEVERITY 12/);
    expect(r.lines.filter((l) => l.cls === "blood").length).toBeGreaterThan(1);
  });

  it("小文字には決め台詞がつく", () => {
    const r = buildListing("000100 identification division.", "T.CBL", NOW);
    expect(r.lines.map((l) => l.text).join("\n")).toContain("LOWERCASE IS HERESY");
  });

  it("DBLINK だけ 8i の亡霊が出る", () => {
    const dblink = [
      "000100 IDENTIFICATION DIVISION.",
      "000200 PROGRAM-ID. T.",
      "000300 ENVIRONMENT DIVISION.",
      "000400 INPUT-OUTPUT SECTION.",
      "000500 FILE-CONTROL.",
      '000600     SELECT X-FILE ASSIGN TO "DBLINK".',
    ].join("\n");
    const ghost = buildListing(dblink, "T.CBL", NOW);
    expect(ghost.lines.some((l) => l.cls === "ghost")).toBe(true);
    expect(ghost.lines.map((l) => l.text).join("\n")).toContain("3 + 1 SERVERS");

    const plain = buildListing("000100 identification division.", "T.CBL", NOW);
    expect(plain.lines.some((l) => l.cls === "ghost")).toBe(false);
  });

  it("警告は黄色のクラスで出し、成功扱いのまま", () => {
    const noStop = ["000100 IDENTIFICATION DIVISION.", "000200 PROGRAM-ID. T.", "000300 PROCEDURE DIVISION.", "000400 MAIN-PARA.", '000500     CALL "DEPLOY".'].join("\n");
    const r = buildListing(noStop, "T.CBL", NOW);
    expect(r.ok).toBe(true);
    expect(r.lines.some((l) => l.cls === "warn" && l.text.includes("MISSING-STOP-RUN"))).toBe(true);
  });

  it("ALB + EC2 + RDS の王道の 3 層構成には、落ちが付く", () => {
    const r = buildListing(golden("three-tier"), "T.CBL", NOW);
    const text = r.lines.map((l) => l.text).join("\n");
    expect(r.ok).toBe(true);
    expect(text).toContain("1998 CALLED");
    expect(r.lines.some((l) => l.cls === "ghost" && l.text.includes("THREE-TIER"))).toBe(true);
  });

  it("3 層でないものには、落ちが付かない", () => {
    for (const name of ["s3", "lambda", "classic", "edge"]) {
      expect(buildListing(golden(name), "T.CBL", NOW).lines.some((l) => l.text.includes("1998 CALLED")), name).toBe(false);
    }
  });

  it("長い文は単語の境目で折り返し、単語を途中で割らない", () => {
    const text = "Load balancer + EC2 + RDS. You wrote modern AWS in ancient COBOL, and out came the classic three-tier architecture. 1998 would like its architecture back";
    const lines = wrap(text, "  ", 96);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(96);
    // 折り返した行を単語ごとにつなぎ直すと、元の文になる
    expect(lines.map((l) => l.trim()).join(" ")).toBe(text);
    expect(lines.join("\n")).not.toMatch(/architecture bac\n/);
  });

  it("空白の無い長い文字列（ARN など）は、桁で折っても切り捨てない", () => {
    const arn = "arn:aws:" + "x".repeat(200);
    const lines = wrap(arn, "    ", 96);
    expect(lines.map((l) => l.trim()).join("")).toBe(arn);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(96);
  });

  it("同じ入力と時刻なら同じ帳票になる（純粋関数）", () => {
    expect(buildListing(golden("s3"), "T.CBL", NOW)).toEqual(buildListing(golden("s3"), "T.CBL", NOW));
  });
});
