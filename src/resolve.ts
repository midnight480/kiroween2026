import { CobolError, type Diagnostic } from "./errors.js";
import type { DataItem, Program, SelectEntry } from "./parser.js";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface Resource {
  logicalId: string;
  /** COBOL 上の名前（01 名、または SELECT 名） */
  name: string;
  type: string;
  group?: DataItem;
  select?: SelectEntry;
  line: number;
  col: number;
}

export interface EmitContext {
  program: Program;
  byName: Map<string, Resource>;
  warnings: Diagnostic[];
  /** 論理 ID → 参照先論理 ID（循環検出用） */
  deps: Map<string, Set<string>>;
  /** 解決済みの主リージョン */
  region: string | undefined;
}

const ATTRIBUTE_ALIASES: Record<string, string> = { ARN: "Arn" };

function link(ctx: EmitContext, from: Resource, to: Resource): void {
  const set = ctx.deps.get(from.logicalId) ?? new Set<string>();
  set.add(to.logicalId);
  ctx.deps.set(from.logicalId, set);
}

/**
 * 規約文字列を解決する（§4.4 / §4.7）。
 * - `REF:<名>`               → Ref（`arn` モードでは Arn 属性）
 * - `REF:<名><接尾辞>`       → Fn::Sub（`${論理ID.Arn}接尾辞`）
 * - `GETATT:<名>.<属性>`     → Fn::GetAtt
 */
export function resolveValue(raw: string, ctx: EmitContext, from: Resource, item: DataItem, mode: "value" | "arn"): Json {
  const lookup = (name: string): Resource => {
    const target = ctx.byName.get(name);
    if (!target) {
      throw new CobolError("UNDEFINED-REFERENCE", `参照先 ${name} が同一ファイル内にありません`, item.line, item.col);
    }
    link(ctx, from, target);
    return target;
  };

  if (raw.startsWith("REF:")) {
    const m = /^REF:([A-Z0-9-]+)(.*)$/s.exec(raw);
    if (!m) throw new CobolError("INVALID-REFERENCE", `参照の書式が不正です: ${raw}`, item.line, item.col);
    const target = lookup(m[1] as string);
    const suffix = m[2] as string;
    if (mode === "arn") {
      return suffix === ""
        ? { "Fn::GetAtt": [target.logicalId, "Arn"] }
        : // 接尾辞はリテラル。Fn::Sub では `${` が置換になるため `${!` にエスケープする
          { "Fn::Sub": `\${${target.logicalId}.Arn}${suffix.replaceAll("${", "${!")}` };
    }
    if (suffix !== "") {
      throw new CobolError("INVALID-REFERENCE", `この項目では REF: に接尾辞を付けられません: ${raw}`, item.line, item.col);
    }
    return { Ref: target.logicalId };
  }

  if (raw.startsWith("GETATT:")) {
    const m = /^GETATT:([A-Z0-9-]+)\.([A-Za-z0-9.]+)$/.exec(raw);
    if (!m) throw new CobolError("INVALID-REFERENCE", `参照の書式が不正です: ${raw}`, item.line, item.col);
    const target = lookup(m[1] as string);
    const attr = m[2] as string;
    return { "Fn::GetAtt": [target.logicalId, ATTRIBUTE_ALIASES[attr] ?? attr] };
  }

  return raw;
}

