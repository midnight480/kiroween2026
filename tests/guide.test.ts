import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { CobolError, formatError, formatWarning } from "../src/errors.js";
import { SPECS } from "../src/mapping/index.js";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const guide = read("docs/GUIDE.md");

/** ```cobol の囲みを、すべて取り出す。 */
const programs = [...guide.matchAll(/```cobol\n([\s\S]*?)\n```/g)].map((m) => m[1] as string);
const text = [...guide.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1] as string).join("\n");

describe("docs/GUIDE.md", () => {
  it("手順書のプログラムは、すべてコンパイルできる", () => {
    expect(programs.length).toBeGreaterThanOrEqual(3);
    for (const p of programs) expect(() => compile(p)).not.toThrow();
  });

  it("手順書のプログラムは、実在するファイルの中身と一字一句同じ（手で写して桁がずれない）", () => {
    const files = ["verify/samples/51-s3.cbl", "tests/golden/policy-ref/input.cbl", "examples/web-network.cbl"].map((f) => read(f).trimEnd());
    for (const p of programs) expect(files, p.split("\n")[1]).toContain(p);
  });

  it("手順書のコードは、どの行も 72 桁以内（読まれない桁に出ていない）", () => {
    for (const p of programs) for (const line of p.split("\n")) expect(line.length, line).toBeLessThanOrEqual(72);
  });

  describe("載せているエラーと警告は、実際の出力と同じ", () => {
    const base = read("examples/web-network.cbl");
    const lines = (s: string): string[] => s.split("\n");

    const errorOf = (name: string, src: string): string => {
      try {
        compile(src);
      } catch (e) {
        if (e instanceof CobolError) return formatError(name, e, "en");
        throw e;
      }
      throw new Error(`${name}: エラーになるはずが成功した`);
    };

    it("綴り間違い（もしかして）", () => {
      const src = base.replace("VPC-DNS-SUPPORT ", "VPC-DNS-SUPORT  ");
      expect(text).toContain(errorOf("typo.cbl", src));
    });

    it("7 桁目のずれ", () => {
      const src = lines(base).map((l, i) => (i === 0 ? l.replace("000100 ", "000100") : l)).join("\n");
      expect(text).toContain(errorOf("shift.cbl", src));
    });

    it("小文字", () => {
      const src = lines(base).map((l, i) => (i === 7 ? l.toLowerCase() : l)).join("\n");
      expect(text).toContain(errorOf("lower.cbl", src));
    });

    it("世界に開いた SSH の警告", () => {
      const src = base.replace("MOVE 443 TO WEB-ING-FROM (1)", "MOVE 22 TO WEB-ING-FROM (1)").replace("MOVE 443 TO WEB-ING-TO (1)", "MOVE 22 TO WEB-ING-TO (1)");
      const warning = compile(src).warnings.find((w) => w.code === "OPEN-TO-THE-WORLD");
      expect(warning).toBeDefined();
      expect(text).toContain(formatWarning("ssh.cbl", warning!, "en"));
    });
  });

  it("書いてある型の数が、実際の数と合っている", () => {
    expect(guide).toContain(`the ${SPECS.size + 6} in [REFERENCE.md]`);
  });

  it("文書同士のリンク先が実在する", () => {
    for (const doc of ["docs/GUIDE.md", "docs/REFERENCE.md"]) {
      for (const m of read(doc).matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        const target = join(ROOT, dirname(doc), m[1] as string);
        expect(existsSync(target), `${doc} -> ${m[1]}`).toBe(true);
      }
    }
  });

  it("日本語が混ざらない（英語の文書）", () => {
    expect(/[ぁ-んァ-ヶ一-龠]/.test(guide)).toBe(false);
  });
});
