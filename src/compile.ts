import { readCards } from "./card.js";
import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import type { Diagnostic } from "./errors.js";
import { applyProcedure, regionFromComputer } from "./semantic.js";
import {
  assertAcyclic,
  collectResources,
  emitResource,
  type EmitContext,
  type JsonObject,
  type Resource,
} from "./emit.js";

export interface CompileResult {
  template: JsonObject;
  /** デプロイ先の主リージョン（解決できなければ undefined） */
  region: string | undefined;
  /** スタック名（PROGRAM-ID） */
  stackName: string;
  /** PROCEDURE の最初の CALL（`DEPLOY` 等）。意図の宣言（§4.6） */
  intent: string | undefined;
  warnings: Diagnostic[];
}

/** 固定形式 COBOL ソース → CloudFormation テンプレート。副作用なし。 */
export function compile(source: string): CompileResult {
  const cards = readCards(source);
  const tokens = lex(cards.lines);
  const program = parse(tokens, cards.warnings);
  applyProcedure(program);

  const resources = collectResources(program);

  // リージョン決定ルール（§4.5）: OBJECT-COMPUTER が唯一の起点、MRSC のみ REPLICA-1 にフォールバック
  let region: string | undefined;
  if (program.objectComputer !== undefined) {
    region = regionFromComputer(program.objectComputer, program.objectComputerLine ?? 1);
  } else {
    const mrsc = resources.find((r) => r.select?.assignTo === "DYNAMODB-MRSC");
    const group = mrsc && program.workingStorage.find((g) => g.name === `${mrsc.name}-REGIONS`);
    const replica1 = group?.children.find((c) => c.name === "REPLICA-1");
    const v = replica1 && (replica1.moved.get(0) ?? replica1.value);
    if (typeof v === "string") region = v;
  }
  if (region === undefined && resources.length > 0) {
    program.warnings.push({
      code: "NO-REGION",
      message: "OBJECT-COMPUTER がありません。デプロイ時は AWS の既定リージョンを使います",
    });
  }

  const ctx: EmitContext = {
    program,
    byName: new Map(resources.map((r) => [r.name, r])),
    warnings: program.warnings,
    deps: new Map(),
    region,
  };

  const out: JsonObject = {};
  for (const r of resources as Resource[]) out[r.logicalId] = emitResource(r, ctx);
  assertAcyclic(ctx, resources);

  const template: JsonObject = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: program.programId,
  };
  if (program.author !== undefined) template["Metadata"] = { Author: program.author };
  template["Resources"] = out;

  const call = program.procedure.find((s) => s.kind === "call");
  return {
    template,
    region,
    stackName: program.programId,
    intent: call && call.kind === "call" ? call.target : undefined,
    warnings: program.warnings,
  };
}
