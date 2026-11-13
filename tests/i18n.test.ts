import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { CobolError, formatError, formatWarning } from "../src/errors.js";
import { getLocale, localize, setLocale } from "../src/i18n.js";

const ROOT = join(import.meta.dirname, "..");
const CJK = /[ぁ-んァ-ヶ一-龠]/;

/** メッセージではない説明用の文字列（コメントや型の説明）。 */
const NOT_MESSAGES = new Set(["PROGRAM-ID. 名前.", "REF:<名>", "REF:<名><接尾辞>", "${論理ID.Arn}接尾辞", "GETATT:<名>.<属性>"]);

const SOURCES = [
  "src/card.ts",
  "src/lexer.ts",
  "src/parser.ts",
  "src/semantic.ts",
  "src/emit.ts",
  "src/resolve.ts",
  "src/compile.ts",
  "src/deploy.ts",
  "src/mapping/engine.ts",
  "src/mapping/network.ts",
  "src/mapping/compute.ts",
  "src/mapping/database.ts",
  "src/mapping/containers.ts",
  "src/mapping/messaging.ts",
];

/** ソースにある、日本語を含む文字列リテラルをすべて取り出す（コメントは除く）。 */
function japaneseLiterals(file: string): string[] {
  const code = readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g)) {
    const text = m[0].slice(1, -1).replaceAll('\\"', '"');
    if (CJK.test(text) && !NOT_MESSAGES.has(text) && !text.includes("もしかして")) out.push(text);
  }
  return out;
}

afterEach(() => setLocale("ja"));

describe("英語への翻訳（訳し漏れの検査）", () => {
  for (const file of SOURCES) {
    it(`${file} の日本語メッセージは、すべて英語に訳される`, () => {
      const untranslated: string[] = [];
      for (const literal of japaneseLiterals(file)) {
        // 実行時の値（${...}）を適当な語に置き換えて、実際に出るメッセージの形にする
        const sample = literal.replace(/\$\{[^}]*\}/g, "X");
        const english = localize(sample, "en");
        if (CJK.test(english) || english === sample) untranslated.push(literal);
      }
      expect(untranslated, `訳が無い:\n${untranslated.join("\n")}`).toEqual([]);
    });
  }

  it("リソース名つきの警告（NAME: 文面）も訳される", () => {
    expect(localize("WEB-SG: ストレージが暗号化されていません", "en")).toBe("WEB-SG: Storage is not encrypted");
  });

  it("実行時の値は、訳文の中にそのまま残る", () => {
    expect(localize("連番 000200 は直前の 000300 以下です。カードデッキが乱れています。ソーターにかけてください", "en")).toBe(
      "Sequence number 000200 is not above the previous 000300. The card deck is out of order. Please run it through the sorter",
    );
    expect(localize("VPC-DNS-SUPORT という項目はありません", "en")).toContain("VPC-DNS-SUPORT");
  });

  it("綴り間違いの『もしかして』も英語になる", () => {
    const text = localize("AWS::EC2::VPC に VPC-DNS-SUPORT という項目はありません（もしかして VPC-DNS-SUPPORT？）", "en");
    expect(text).toBe("AWS::EC2::VPC has no item named VPC-DNS-SUPORT (did you mean VPC-DNS-SUPPORT?)");
  });

  it("日本語を選べば、そのまま返す。訳の無い文面も消さずに返す", () => {
    expect(localize("名前が必要です", "ja")).toBe("名前が必要です");
    expect(localize("まだ訳の無い文面です", "en")).toBe("まだ訳の無い文面です");
  });
});

describe("言語の切り替え", () => {
  it("既定は日本語で、setLocale で英語にできる", () => {
    expect(getLocale()).toBe("ja");
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(localize("名前が必要です")).toBe("A name is required");
  });

  it("エラーの整形が英語になり、番号・行・桁・コードはそのまま", () => {
    const e = new CobolError("INVALID-INDICATOR", "7 桁目は空白・*・-・D・/ のみ使えます（'I' があります）。桁がずれていませんか", 1, 7);
    expect(formatError("a.cbl", e, "en")).toBe(
      "a.cbl:1:7: CBF-0003-S SEVERITY 12: Column 7 may only hold a space, *, -, D or /. Found 'I'. Is the code shifted? [INVALID-INDICATOR]",
    );
    expect(formatError("a.cbl", e, "ja")).toContain("桁がずれていませんか");
  });

  it("小文字の決め台詞は、英語でも日本語でも出る", () => {
    try {
      compile("000100 identification division.");
    } catch (err) {
      const e = err as CobolError;
      expect(formatError("a.cbl", e, "en")).toContain("LOWERCASE IS HERESY — Reserved words and data names must be upper case: identification");
      expect(formatError("a.cbl", e, "ja")).toContain("LOWERCASE IS HERESY — 予約語");
    }
  });

  it("警告の整形も英語になる", () => {
    expect(formatWarning("a.cbl", { code: "MISSING-STOP-RUN", message: "PROGRAM-ID がありません", line: 3 }, "en")).toBe(
      "a.cbl:3: CBF-0038-W SEVERITY 4: PROGRAM-ID is missing [MISSING-STOP-RUN]",
    );
  });

  it("英語のとき、実際のコンパイル結果にも日本語が混ざらない（3 層構成の落ちを含む）", () => {
    const src = readFileSync(join(ROOT, "tests/golden/three-tier/input.cbl"), "utf8");
    const warnings = compile(src).warnings.map((w) => formatWarning("t.cbl", w, "en"));
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) expect(CJK.test(w), w).toBe(false);
    expect(warnings.join("\n")).toContain("1998 would like its architecture back");
  });
});
