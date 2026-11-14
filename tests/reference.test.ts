import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPECS } from "../src/mapping/index.js";
import { HAND_WRITTEN, renderReference, rulesFrom } from "../src/reference.js";

const ROOT = join(import.meta.dirname, "..");
const dir = join(ROOT, "src", "mapping");
const sources = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith(".ts")).map((n) => [n, readFileSync(join(dir, n), "utf8")]));
const generated = renderReference(SPECS, sources);

describe("docs/REFERENCE.md", () => {
  it("対応表から作った内容と一致している（古ければ npm run docs:reference）", () => {
    const onDisk = readFileSync(join(ROOT, "docs", "REFERENCE.md"), "utf8");
    expect(onDisk, "docs/REFERENCE.md が古い。`npm run docs:reference` で作り直してください").toBe(generated);
  });

  it("対応表のすべての型と、すべての項目名を載せている", () => {
    for (const spec of SPECS.values()) {
      expect(generated, spec.type).toContain(`### ${spec.type}\n`);
      for (const f of spec.fields) expect(generated, `${spec.type} / ${f.name}`).toContain(`\`${f.name}\``);
      for (const l of spec.lists ?? []) for (const f of l.fields) expect(generated, `${spec.type} / ${f.name}`).toContain(`\`...${f.name}\``);
    }
  });

  it("どの型も、ちょうど 1 回だけ載っている", () => {
    for (const spec of SPECS.values()) {
      expect(generated.split(`### ${spec.type}\n`).length - 1, spec.type).toBe(1);
    }
  });

  it("手書きの節の項目名は、実装（src/emit.ts）に実在する", () => {
    const emit = readFileSync(join(ROOT, "src", "emit.ts"), "utf8");
    // 接尾辞（`-EFFECT` など）も、そのまま実装の中に書かれている
    for (const h of HAND_WRITTEN) for (const n of h.names) expect(emit, `${h.type} / ${n}`).toContain(`"${n}"`);
  });

  it("post の中の警告・エラーが、メッセージごと載っている（英語で）", () => {
    expect(generated).toContain("`OPEN-TO-THE-WORLD`");
    expect(generated).toContain("`CLOUDFRONT-CERT-REGION`");
    expect(generated).toContain("CloudFront certificates must come from ACM in us-east-1");
    expect(generated).toContain("`ALB-NO-SG`");
  });

  it("共通の関数で検査している規則（FIFO、パスワード）は notes から載る", () => {
    expect(generated).toContain("must end in `.fifo`");
    expect(generated).toContain("a plain-text value is rejected");
  });

  it("対応表の warn / fail の呼び出しを、1 つも取りこぼさない", () => {
    for (const spec of SPECS.values()) {
      const file = Object.keys(sources).find((f) => (sources[f] as string).includes(`type: "${spec.type}"`)) as string;
      const src = sources[file] as string;
      const start = src.indexOf(`type: "${spec.type}"`);
      const next = src.indexOf('\n    type: "', start + 10);
      const block = src.slice(start, next < 0 ? src.length : next);
      const calls = (block.match(/h\.(warn|fail)\(/g) ?? []).length;
      expect(rulesFrom(block).length, `${spec.type}: ${calls} 個の呼び出しのうち、取り出せたもの`).toBe(calls);
    }
  });

  it("名前と値だけでできた文面は、意味の通る説明に置き換わっている", () => {
    expect(generated).toContain("covers SSH (22), RDP (3389), MySQL (3306) or PostgreSQL (5432)");
    expect(generated).not.toContain("<value> (<value>) is open");
  });

  it("手書きの型の数が、実際の数と合っている（46 型 = 表 + 6）", () => {
    expect(generated).toContain(`${SPECS.size + 6} AWS resource types`);
    expect(generated).toContain("and 6 with hand-written code");
  });

  it("日本語が混ざらない（英語の文書）", () => {
    expect(/[ぁ-んァ-ヶ一-龠]/.test(generated)).toBe(false);
  });

  it("<value> の穴あきメッセージは、意味が通る英文になっている", () => {
    const hole = generated.split("\n").filter((l) => l.includes("<value>"));
    expect(hole.length).toBeGreaterThan(0);
    for (const l of hole) expect(l).toMatch(/^- (Warning|Error) `[A-Z0-9-]+`: .*[a-z]/);
  });
});
