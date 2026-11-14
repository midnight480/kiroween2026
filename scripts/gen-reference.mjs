// docs/REFERENCE.md を、対応表から作り直す。`npm run docs:reference` から呼ぶ（先にビルドする）。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPECS } from "../dist/mapping/index.js";
import { renderReference } from "../dist/reference.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src", "mapping");
const sources = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith(".ts")).map((n) => [n, readFileSync(join(dir, n), "utf8")]));

writeFileSync(join(root, "docs", "REFERENCE.md"), renderReference(SPECS, sources));
console.log(`docs/REFERENCE.md を作りました（${SPECS.size + 6} 型）`);
