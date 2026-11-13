import { CobolError } from "../errors.js";
import type { DataItem } from "../parser.js";
import { resolveValue, type EmitContext, type Json, type JsonObject, type Resource } from "../resolve.js";
import { effectiveValue, walk } from "../semantic.js";
import { GENERIC_FIELDS, getPath, setPath, type Field, type Hook, type ListSpec, type ResourceSpec } from "./spec.js";

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) (dp[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      (dp[i] as number[])[j] = Math.min(
        (dp[i - 1] as number[])[j]! + 1,
        (dp[i] as number[])[j - 1]! + 1,
        (dp[i - 1] as number[])[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return (dp[a.length] as number[])[b.length] as number;
}

/** 綴り間違いのヒント。近い名前があれば「もしかして」を返す。 */
function suggest(name: string, known: string[]): string {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const k of known) {
    const d = levenshtein(name, k);
    if (d < bestDistance) {
      best = k;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(name.length / 4)) ? `（もしかして ${best}？）` : "";
}

function fail(code: string, message: string, item: { line: number; col: number }): never {
  throw new CobolError(code, message, item.line, item.col);
}

function convert(field: Field, item: DataItem, raw: string | number, r: Resource, ctx: EmitContext): Json {
  const text = String(raw);

  if (field.enum && !field.enum.includes(text)) {
    fail("INVALID-VALUE", `${field.name} は ${field.enum.join(" / ")} のどれかです（${text} が書かれています）`, item);
  }

  switch (field.kind) {
    case "bool":
      if (text !== "Y" && text !== "N") fail("INVALID-VALUE", `${field.name} は "Y" か "N" です（${text} が書かれています）`, item);
      return text === "Y";

    case "number":
    case "numstr": {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n)) fail("INVALID-VALUE", `${field.name} は数値です（${text} が書かれています）`, item);
      return field.kind === "number" ? n : String(n);
    }

    case "string":
      if (field.map) {
        if (!(text in field.map)) {
          fail("INVALID-VALUE", `${field.name} は ${Object.keys(field.map).join(" / ")} のどれかです（${text} が書かれています）`, item);
        }
        return field.map[text] as Json;
      }
      return text;

    case "ref":
      return resolveValue(text, ctx, r, item, "value");

    case "strings": {
      const parts = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
      if (parts.length === 0) fail("INVALID-VALUE", `${field.name} には 1 つ以上の値が必要です`, item);
      return parts.map((p) => resolveValue(p, ctx, r, item, "value"));
    }

    case "targets": {
      const parts = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
      return parts.map((p) => ({ Id: resolveValue(p, ctx, r, item, "value") }));
    }

    case "ssm":
      return dynamicReference(text);

    case "secret": {
      const ref = dynamicReference(text);
      if (typeof ref === "string" && !ref.startsWith("{{resolve:")) {
        fail(
          "PLAIN-PASSWORD",
          `${field.name} に平文のパスワードは書けません。SECRET:<名前> か SSM:<パス> で参照してください（マスターパスワードは ManageMasterUserPassword に任せるのが最善です）`,
          item,
        );
      }
      return ref;
    }

    case "userdata":
      return { "Fn::Base64": text.replaceAll("\\n", "\n") };
  }
}

/** `SSM:/path` → `{{resolve:ssm:/path}}`、`SECRET:id` → `{{resolve:secretsmanager:id}}`。それ以外はそのまま。 */
function dynamicReference(text: string): string {
  if (text.startsWith("SSM:")) return `{{resolve:ssm:${text.slice(4)}}}`;
  if (text.startsWith("SECRET:")) return `{{resolve:secretsmanager:${text.slice(7)}}}`;
  return text;
}

function findGroup(group: DataItem, suffix: string): DataItem | undefined {
  let found: DataItem | undefined;
  walk(group.children, (i) => {
    if (found === undefined && i.occurs !== undefined && i.name.endsWith(suffix)) found = i;
  });
  return found;
}

function emitList(list: ListSpec, g: DataItem, r: Resource, ctx: EmitContext, props: JsonObject): void {
  const occurs = findGroup(g, list.group);
  if (!occurs) return;

  const items: Json[] = [];
  for (let n = 1; n <= (occurs.occurs as number); n++) {
    const obj: JsonObject = {};
    let any = false;
    for (const f of list.fields) {
      const child = occurs.children.find((c) => c.name.endsWith(f.name));
      const raw = child && effectiveValue(child, n);
      if (child === undefined || raw === undefined) {
        if (f.default !== undefined) setPath(obj, f.cfn, f.default);
        else if (f.required) fail("MISSING-PROPERTY", `${occurs.name} (${n}) に *${f.name} が必要です`, occurs);
        continue;
      }
      any = true;
      setPath(obj, f.cfn, convert(f, child, raw, r, ctx));
    }
    if (!any) fail("MISSING-PROPERTY", `${occurs.name} (${n}) が空です。MOVE で値を入れてください`, occurs);
    items.push(obj);
  }
  setPath(props, list.cfn, items);
}

/** 対応表に従って 1 つのリソースを出力する。 */
export function emitFromSpec(r: Resource, spec: ResourceSpec, ctx: EmitContext): JsonObject {
  const g = r.group as DataItem;
  const props: JsonObject = {};

  // --- 入力項目の索引（OCCURS の中は別扱い）
  const leaves = new Map<string, DataItem>();
  walk(g.children, (i) => {
    if (i.pic !== undefined && !(i.parent && i.parent !== g && i.parent.occurs !== undefined)) leaves.set(i.name, i);
  });

  // --- 綴り間違いは黙って捨てない（安全設定の書き損じを見逃さない）
  const known = [...spec.fields.map((f) => f.name), ...GENERIC_FIELDS];
  for (const [name, item] of leaves) {
    if (!known.includes(name) && !(item.parent && item.parent.occurs !== undefined)) {
      fail("UNKNOWN-PROPERTY", `${r.type} に ${name} という項目はありません${suggest(name, known)}`, item);
    }
  }
  for (const list of spec.lists ?? []) {
    const occurs = findGroup(g, list.group);
    if (!occurs) continue;
    for (const c of occurs.children) {
      if (!list.fields.some((f) => c.name.endsWith(f.name))) {
        fail("UNKNOWN-PROPERTY", `${occurs.name} に *${list.fields.map((f) => f.name).join(" / *")} 以外の項目 ${c.name} があります`, c);
      }
    }
  }

  // --- 項目
  for (const f of spec.fields) {
    const item = leaves.get(f.name);
    const raw = item && effectiveValue(item);
    if (item === undefined || raw === undefined) {
      if (f.required) fail("MISSING-PROPERTY", `${r.name} に ${f.name} が必要です`, g);
      continue;
    }
    setPath(props, f.cfn, convert(f, item, raw, r, ctx));
  }
  for (const list of spec.lists ?? []) emitList(list, g, r, ctx, props);

  // --- 既定値（書かれていないものだけ）
  for (const f of spec.fields) {
    if (f.default !== undefined && getPath(props, f.cfn) === undefined) setPath(props, f.cfn, f.default);
  }

  // --- 名前タグ
  const nameTag = leaves.get("NAME-TAG");
  if (spec.tags && nameTag && effectiveValue(nameTag) !== undefined) {
    props["Tags"] = [{ Key: "Name", Value: String(effectiveValue(nameTag)) }];
  }

  // --- 専用ロジック
  const hook: Hook = {
    resource: r,
    region: ctx.region,
    has: (p) => getPath(props, p) !== undefined,
    get: (p) => getPath(props, p),
    set: (p, v) => setPath(props, p, v),
    wrote: (n) => {
      const it = leaves.get(n);
      return it !== undefined && effectiveValue(it) !== undefined;
    },
    warn: (code, message) => ctx.warnings.push({ code, message: `${r.name}: ${message}`, line: g.line }),
    fail: (code, message) => fail(code, `${r.name}: ${message}`, g),
  };
  spec.post?.(hook);

  // --- リソース属性
  const node: JsonObject = { Type: r.type };
  const deletion = leaves.get("DELETION-POLICY");
  const deletionValue = deletion && effectiveValue(deletion);
  if (deletion && deletionValue !== undefined) {
    const v = String(deletionValue);
    if (!["Delete", "Retain", "Snapshot"].includes(v)) {
      fail("INVALID-VALUE", `DELETION-POLICY は Delete / Retain / Snapshot のどれかです（${v} が書かれています）`, deletion);
    }
    node["DeletionPolicy"] = v;
  }
  const dep = leaves.get("DEPENDS-ON");
  const depValue = dep && effectiveValue(dep);
  if (dep && depValue !== undefined) {
    const ids = String(depValue)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map((name) => {
        const target = ctx.byName.get(name);
        if (!target) fail("UNDEFINED-REFERENCE", `DEPENDS-ON の ${name} が同一ファイル内にありません`, dep);
        const set = ctx.deps.get(r.logicalId) ?? new Set<string>();
        set.add(target.logicalId);
        ctx.deps.set(r.logicalId, set);
        return target.logicalId;
      });
    node["DependsOn"] = ids.length === 1 ? (ids[0] as string) : ids;
  }
  node["Properties"] = props;
  return node;
}
