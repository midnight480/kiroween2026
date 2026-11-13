import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPECS } from "../src/mapping/index.js";
import { GENERIC_FIELDS, type Field, type ResourceSpec } from "../src/mapping/spec.js";

interface SchemaSnapshot {
  type: string;
  paths: Record<string, { type: string; enum?: string[] }>;
}

function snapshot(type: string): SchemaSnapshot {
  const file = join(import.meta.dirname, "schemas", `${type.replaceAll("::", "_")}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as SchemaSnapshot;
}

/** `Origins.0.DomainName` → `Origins.*.DomainName`（スナップショットは配列を * で持つ） */
const toSchemaPath = (p: string): string => p.split(".").map((s) => (/^\d+$/.test(s) ? "*" : s)).join(".");

const specs = [...SPECS.values()];
const allFields = (spec: ResourceSpec): Array<{ field: Field; schemaPath: string }> => [
  ...spec.fields.map((field) => ({ field, schemaPath: field.schemaPath ?? toSchemaPath(field.cfn) })),
  ...(spec.lists ?? []).flatMap((l) =>
    l.fields.map((field) => ({ field, schemaPath: `${toSchemaPath(l.cfn)}.*.${field.schemaPath ?? toSchemaPath(field.cfn)}` })),
  ),
];

describe("対応表 × 公式スキーマ（cfn-lint 同梱）", () => {
  for (const spec of specs) {
    describe(spec.type, () => {
      const schema = snapshot(spec.type);

      it("対応表のプロパティは、すべて公式スキーマに実在する", () => {
        const missing = allFields(spec)
          .filter(({ schemaPath }) => !(schemaPath in schema.paths))
          .map(({ field, schemaPath }) => `${field.name} → ${schemaPath}`);
        expect(missing, `スキーマに無いプロパティ:\n${missing.join("\n")}`).toEqual([]);
      });

      it("列挙値と既定値は、公式スキーマの許す値の範囲に収まる", () => {
        const bad: string[] = [];
        for (const { field, schemaPath } of allFields(spec)) {
          // 数値の列挙（ログの保持日数など）は文字列にそろえて比べる
          const allowed = schema.paths[schemaPath]?.enum?.map(String);
          if (!allowed) continue;
          for (const v of field.enum ?? []) if (!allowed.includes(v)) bad.push(`${field.name}: 列挙値 ${v} は ${allowed.join("|")} に無い`);
          if ((typeof field.default === "string" || typeof field.default === "number") && !allowed.includes(String(field.default))) {
            bad.push(`${field.name}: 既定値 ${field.default} は ${allowed.join("|")} に無い`);
          }
        }
        expect(bad).toEqual([]);
      });

      it("文字列の一覧（strings）は、スキーマ上も配列である", () => {
        const bad = allFields(spec)
          .filter(({ field }) => field.kind === "strings" || field.kind === "targets")
          .filter(({ schemaPath }) => schema.paths[schemaPath]?.type !== "array")
          .map(({ field, schemaPath }) => `${field.name} → ${schemaPath} (${schema.paths[schemaPath]?.type})`);
        expect(bad).toEqual([]);
      });

      it("数値（number）は数値、文字列で受ける数値（numstr）は文字列である", () => {
        const bad: string[] = [];
        for (const { field, schemaPath } of allFields(spec)) {
          // スキーマが中身を持たない object の内側（schemaPath 指定）は、末端の型を公式スキーマで確かめられない
          if (field.schemaPath !== undefined) continue;
          const t = schema.paths[schemaPath]?.type;
          if (field.kind === "number" && t !== "integer" && t !== "number") bad.push(`${field.name}: number だがスキーマは ${t}`);
          if (field.kind === "numstr" && t !== "string") bad.push(`${field.name}: numstr だがスキーマは ${t}`);
          if (field.kind === "bool" && t !== "boolean") bad.push(`${field.name}: bool だがスキーマは ${t}`);
        }
        expect(bad).toEqual([]);
      });
    });
  }
});

describe("対応表の COBOL 名", () => {
  const names = specs.flatMap((s) => s.fields.map((f) => f.name));

  it("大文字とハイフンだけで、30 桁以内（COBOL-85 の上限）", () => {
    const all = [...names, ...specs.flatMap((s) => (s.lists ?? []).flatMap((l) => [l.group, ...l.fields.map((f) => f.name)]))];
    for (const n of all) {
      expect(n, n).toMatch(/^-?[A-Z0-9]+(-[A-Z0-9]+)*$/);
      expect(n.length, n).toBeLessThanOrEqual(30);
    }
  });

  it("リソース型をまたいで項目名が重複しない（MOVE の転送先を曖昧にしない）", () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const s of specs) {
      for (const f of s.fields) {
        const prev = seen.get(f.name);
        if (prev && prev !== s.type) dup.push(`${f.name}: ${prev} と ${s.type}`);
        seen.set(f.name, s.type);
      }
    }
    expect(dup).toEqual([]);
  });

  it("共通の項目名（RESOURCE-TYPE など）を、対応表が横取りしていない", () => {
    for (const g of GENERIC_FIELDS) expect(names).not.toContain(g);
  });

  it("リスト内の接尾辞は、互いに他の接尾辞にならない（どの項目か一意に決まる）", () => {
    for (const s of specs) {
      for (const l of s.lists ?? []) {
        for (const a of l.fields) {
          for (const b of l.fields) {
            if (a !== b) expect(a.name.endsWith(b.name), `${s.type}: ${a.name} は ${b.name} で終わる`).toBe(false);
          }
        }
      }
    }
  });

  const cobc = ["/opt/homebrew/bin/cobc", "/usr/local/bin/cobc", "/usr/bin/cobc"].find((p) => existsSync(p));
  it.skipIf(!cobc)("COBOL の予約語と衝突しない（GnuCOBOL の予約語表と照合）", () => {
    const out = execFileSync(cobc as string, ["--list-reserved"], { encoding: "utf8" });
    const reserved = new Set(out.split(/\s+/).map((w) => w.toUpperCase()));
    const all = [
      ...names,
      ...specs.flatMap((s) => (s.lists ?? []).flatMap((l) => l.fields.map((f) => `X${f.name}`))),
      ...GENERIC_FIELDS,
    ];
    const hits = all.filter((n) => reserved.has(n));
    expect(hits, `予約語と衝突: ${hits.join(", ")}`).toEqual([]);
  });
});
