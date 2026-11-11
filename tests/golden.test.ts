import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";

const GOLDEN = join(import.meta.dirname, "golden");
// CI では更新を無効化し、不一致を必ず失敗にする（§9.2）
const update = process.env["UPDATE_GOLDEN"] === "1" && !process.env["CI"];

describe("golden: .cbl → 期待 CFN", () => {
  for (const name of readdirSync(GOLDEN).sort()) {
    it(name, () => {
      const dir = join(GOLDEN, name);
      const actual = compile(readFileSync(join(dir, "input.cbl"), "utf8")).template;
      const expectedPath = join(dir, "expected.json");

      if (update) {
        writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
      }
      expect(existsSync(expectedPath), `${name}/expected.json がありません（人手レビュー後に UPDATE_GOLDEN=1 で生成）`).toBe(true);
      expect(actual).toEqual(JSON.parse(readFileSync(expectedPath, "utf8")));
    });
  }
});
