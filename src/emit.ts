import { CobolError } from "./errors.js";
import type { DataItem, Program, SelectEntry } from "./parser.js";
import { resolveValue, type EmitContext, type JsonObject, type Json, type Resource } from "./resolve.js";
import { emitFromSpec, SPECS } from "./mapping/index.js";
import { child, effectiveValue, pascalCase, walk } from "./semantic.js";

export { resolveValue } from "./resolve.js";
export type { EmitContext, Json, JsonObject, Resource } from "./resolve.js";

const SUPPORTED_TYPES = new Set([
  "AWS::S3::Bucket",
  "AWS::IAM::Role",
  "AWS::IAM::ManagedPolicy",
  "AWS::Lambda::Function",
]);

// ---------------------------------------------------------------- 収集

export function collectResources(program: Program): Resource[] {
  const out: Resource[] = [];
  for (const group of program.workingStorage) {
    const typeItem = child(group, "RESOURCE-TYPE");
    if (!typeItem) continue; // WS-FS や -REGIONS 等、リソースではない 01
    const type = effectiveValue(typeItem);
    if (typeof type !== "string" || !(SUPPORTED_TYPES.has(type) || SPECS.has(type))) {
      throw new CobolError(
        "UNSUPPORTED-RESOURCE-TYPE",
        `MVP で対応していないリソース型です: ${String(type)}`,
        typeItem.line,
        typeItem.col,
      );
    }
    out.push({ logicalId: pascalCase(group.name), name: group.name, type, group, line: group.line, col: group.col });
  }

  for (const select of program.selects) {
    out.push({
      logicalId: pascalCase(select.name),
      name: select.name,
      type: dbType(select),
      select,
      line: select.line,
      col: select.col,
    });
  }

  const seen = new Map<string, Resource>();
  for (const r of out) {
    const dup = seen.get(r.logicalId);
    if (dup) {
      throw new CobolError("DUPLICATE-RESOURCE", `論理 ID ${r.logicalId} が ${dup.name} と ${r.name} で重複しています`, r.line, r.col);
    }
    seen.set(r.logicalId, r);
  }
  return out;
}

function dbType(select: SelectEntry): string {
  switch (select.assignTo) {
    case "DYNAMODB":
      return "AWS::DynamoDB::Table";
    case "DYNAMODB-MRSC":
      return "AWS::DynamoDB::GlobalTable";
    case "DBLINK":
      throw new CobolError(
        "DBLINK-RETIRED",
        "DB リンクの相互接続で冗長化する時代は終わりました。DYNAMODB-MRSC を使ってください",
        select.line,
        select.col,
      );
    case "AURORA-DSQL":
      throw new CobolError("UNSUPPORTED-IN-MVP", "AURORA-DSQL はストレッチ対象です（MVP は DYNAMODB / DYNAMODB-MRSC）", select.line, select.col);
    default:
      throw new CobolError("UNKNOWN-DB-ENGINE", `未知の DB エンジンです: ${select.assignTo}`, select.line, select.col);
  }
}

/** 参照グラフの循環を検出する（§4.8）。 */
export function assertAcyclic(ctx: EmitContext, resources: Resource[]): void {
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(resources.map((r) => [r.logicalId, r]));

  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      const r = byId.get(id) as Resource;
      throw new CobolError("CIRCULAR-REFERENCE", `循環参照です: ${[...path, id].join(" → ")}`, r.line, r.col);
    }
    state.set(id, "visiting");
    for (const next of ctx.deps.get(id) ?? []) visit(next, [...path, id]);
    state.set(id, "done");
  };
  for (const r of resources) visit(r.logicalId, []);
}

// ---------------------------------------------------------------- 共通

function requireItem(group: DataItem, name: string, resource: Resource): DataItem {
  const item = child(group, name);
  if (!item || effectiveValue(item) === undefined) {
    throw new CobolError("MISSING-PROPERTY", `${resource.name} に ${name} が必要です`, group.line, group.col);
  }
  return item;
}

function str(item: DataItem): string {
  const v = effectiveValue(item);
  return String(v);
}

// ---------------------------------------------------------------- S3

function emitBucket(r: Resource, ctx: EmitContext): JsonObject {
  const g = r.group as DataItem;
  const props: JsonObject = {};

  const name = child(g, "BUCKET-NAME");
  if (name && effectiveValue(name) !== undefined) props["BucketName"] = str(name);

  const versioning = child(g, "VERSIONING-FLAG");
  props["VersioningConfiguration"] = {
    Status: versioning && effectiveValue(versioning) === "Y" ? "Enabled" : "Suspended",
  };

  const block = child(g, "BLOCK-PUBLIC");
  const blockAll = !(block && effectiveValue(block) === "N"); // 省略時は全ブロック（Security by default）
  if (!blockAll) {
    ctx.warnings.push({
      code: "PUBLIC-ACCESS-ALLOWED",
      message: `${r.name}: BLOCK-PUBLIC "N" はパブリックアクセスを許可します（赤インク警告）`,
      line: (block as DataItem).line,
    });
  }
  props["PublicAccessBlockConfiguration"] = {
    BlockPublicAcls: blockAll,
    IgnorePublicAcls: blockAll,
    BlockPublicPolicy: blockAll,
    RestrictPublicBuckets: blockAll,
  };
  return props;
}

// ---------------------------------------------------------------- IAM

function emitRole(r: Resource): JsonObject {
  const g = r.group as DataItem;
  const trust = str(requireItem(g, "TRUST-SERVICE", r));
  const props: JsonObject = {
    AssumeRolePolicyDocument: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: trust }, Action: "sts:AssumeRole" }],
    },
  };

  const managed = child(g, "MANAGED-POLICY");
  if (managed && effectiveValue(managed) !== undefined) {
    const v = str(managed);
    if (v.startsWith("AWS-MANAGED:")) {
      props["ManagedPolicyArns"] = [`arn:aws:iam::aws:policy/${v.slice("AWS-MANAGED:".length)}`];
    } else if (v.startsWith("arn:")) {
      props["ManagedPolicyArns"] = [v];
    } else {
      throw new CobolError("INVALID-MANAGED-POLICY", `MANAGED-POLICY は AWS-MANAGED:<パス> か ARN で指定してください: ${v}`, managed.line, managed.col);
    }
  }
  return props;
}

function emitManagedPolicy(r: Resource, ctx: EmitContext): JsonObject {
  const g = r.group as DataItem;
  const stmt = g.children.find((c) => c.occurs !== undefined);
  if (!stmt) {
    throw new CobolError("MISSING-PROPERTY", `${r.name} に OCCURS の STMT グループが必要です`, g.line, g.col);
  }
  const find = (suffix: string): DataItem => {
    const it = stmt.children.find((c) => c.name.endsWith(suffix));
    if (!it) throw new CobolError("MISSING-PROPERTY", `${stmt.name} に *${suffix} 項目が必要です`, stmt.line, stmt.col);
    return it;
  };
  const effect = find("-EFFECT");
  const action = find("-ACTION");
  const res = find("-RES");

  const statements: Json[] = [];
  for (let i = 1; i <= (stmt.occurs as number); i++) {
    const e = effectiveValue(effect, i);
    const a = effectiveValue(action, i);
    const rv = effectiveValue(res, i);
    if (e === undefined || a === undefined || rv === undefined) {
      throw new CobolError("MISSING-PROPERTY", `${stmt.name} (${i}) の Effect/Action/Resource が揃っていません`, stmt.line, stmt.col);
    }
    if (String(a) === "*" || String(a).endsWith(":*")) {
      ctx.warnings.push({ code: "WILDCARD-ACTION", message: `${r.name}: 呪われたワイルドカード Action "${String(a)}"`, line: action.line });
    }
    statements.push({
      Effect: String(e),
      Action: String(a),
      Resource: resolveValue(String(rv), ctx, r, res, "arn"),
    });
  }
  return { PolicyDocument: { Version: "2012-10-17", Statement: statements } };
}

// ---------------------------------------------------------------- Lambda

function emitFunction(r: Resource, ctx: EmitContext): JsonObject {
  const g = r.group as DataItem;
  const props: JsonObject = {};

  props["Runtime"] = str(requireItem(g, "FN-RUNTIME", r));
  props["Handler"] = str(requireItem(g, "FN-HANDLER", r));

  const mem = child(g, "FN-MEMORY");
  if (mem && effectiveValue(mem) !== undefined) props["MemorySize"] = Number(effectiveValue(mem));
  const timeout = child(g, "FN-TIMEOUT-SEC");
  if (timeout && effectiveValue(timeout) !== undefined) props["Timeout"] = Number(effectiveValue(timeout));

  const roleItem = requireItem(g, "FN-ROLE-ARN", r);
  props["Role"] = resolveValue(str(roleItem), ctx, r, roleItem, "value");

  const s3 = child(g, "FN-CODE-S3");
  const inline = child(g, "FN-CODE-INLINE");
  if (s3 && effectiveValue(s3) !== undefined) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(str(s3));
    if (!m) {
      throw new CobolError("INVALID-CODE-LOCATION", `FN-CODE-S3 は s3://<バケット>/<キー> で指定してください: ${str(s3)}`, s3.line, s3.col);
    }
    props["Code"] = { S3Bucket: m[1] as string, S3Key: m[2] as string };
  } else if (inline && effectiveValue(inline) !== undefined) {
    props["Code"] = { ZipFile: str(inline) };
  } else {
    ctx.warnings.push({
      code: "NO-CODE",
      message: `${r.name}: Lambda の Code（FN-CODE-S3 / FN-CODE-INLINE）がありません。このままではデプロイできません`,
      line: g.line,
    });
  }
  return props;
}

// ---------------------------------------------------------------- DynamoDB

const AP_REGION_SET = new Set(["ap-northeast-1", "ap-northeast-2", "ap-northeast-3"]);

function emitTable(r: Resource, ctx: EmitContext): JsonObject {
  const select = r.select as SelectEntry;
  const fd = ctx.program.fds.find((f) => f.name === select.name);
  if (!fd) {
    throw new CobolError("MISSING-FD", `${select.name} に対応する FD がありません`, select.line, select.col);
  }
  if (!select.recordKey) {
    throw new CobolError("MISSING-KEY", `${select.name} に RECORD KEY がありません`, select.line, select.col);
  }

  const fields = new Map<string, DataItem>();
  walk(fd.record, (i) => {
    if (i.pic) fields.set(i.name, i);
  });
  const attr = (name: string): Json => {
    const f = fields.get(name);
    if (!f) throw new CobolError("UNDEFINED-NAME", `キー ${name} が FD ${fd.name} のレコードにありません`, select.line, select.col);
    return { AttributeName: name, AttributeType: (f.pic as NonNullable<DataItem["pic"]>).kind === "9" ? "N" : "S" };
  };

  // キー属性のみ AttributeDefinitions に出す（§4.7(d)）
  const definitions: Json[] = [attr(select.recordKey)];
  const gsis: Json[] = [];
  for (const alt of select.alternateKeys) {
    definitions.push(attr(alt.name));
    gsis.push({
      IndexName: `${alt.name.toLowerCase()}-index`,
      KeySchema: [{ AttributeName: alt.name, KeyType: "HASH" }],
      Projection: { ProjectionType: "ALL" },
    });
  }

  const props: JsonObject = {
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: definitions,
    KeySchema: [{ AttributeName: select.recordKey, KeyType: "HASH" }],
  };
  if (gsis.length > 0) props["GlobalSecondaryIndexes"] = gsis;

  if (select.assignTo === "DYNAMODB-MRSC") {
    const regionsGroup = ctx.program.workingStorage.find((g) => g.name === `${select.name}-REGIONS`);
    if (!regionsGroup) {
      throw new CobolError("MISSING-REGIONS", `${select.name}-REGIONS グループ（REPLICA-1 / REPLICA-2 / WITNESS-REGION）が必要です`, select.line, select.col);
    }
    const replica1 = str(requireItem(regionsGroup, "REPLICA-1", r));
    const replica2 = str(requireItem(regionsGroup, "REPLICA-2", r));
    const witness = str(requireItem(regionsGroup, "WITNESS-REGION", r));

    if (new Set([replica1, replica2, witness]).size !== 3) {
      throw new CobolError("DUPLICATE-REGION", "REPLICA-1 / REPLICA-2 / WITNESS-REGION は互いに別のリージョンにしてください", regionsGroup.line, regionsGroup.col);
    }
    for (const reg of [replica1, replica2, witness]) {
      if (!AP_REGION_SET.has(reg)) {
        ctx.warnings.push({
          code: "REGION-SET",
          message: `${reg} は AP region set（東京・ソウル・大阪）の外です。MRSC は同一 region set 内でのみ構成できます`,
          line: regionsGroup.line,
        });
      }
    }
    if (ctx.region !== undefined && ![replica1, replica2].includes(ctx.region)) {
      throw new CobolError(
        "STACK-REGION-NOT-A-REPLICA",
        `主リージョン ${ctx.region} が REPLICA-1 / REPLICA-2 にありません（スタックのリージョンのレプリカは必須）`,
        regionsGroup.line,
        regionsGroup.col,
      );
    }

    props["MultiRegionConsistency"] = "STRONG";
    props["Replicas"] = [{ Region: replica1 }, { Region: replica2 }];
    props["GlobalTableWitnesses"] = [{ Region: witness }];
  }
  return props;
}

// ---------------------------------------------------------------- 入口

export function emitResource(r: Resource, ctx: EmitContext): JsonObject {
  let properties: JsonObject;
  switch (r.type) {
    case "AWS::S3::Bucket":
      properties = emitBucket(r, ctx);
      break;
    case "AWS::IAM::Role":
      properties = emitRole(r);
      break;
    case "AWS::IAM::ManagedPolicy":
      properties = emitManagedPolicy(r, ctx);
      break;
    case "AWS::Lambda::Function":
      properties = emitFunction(r, ctx);
      break;
    case "AWS::DynamoDB::Table":
    case "AWS::DynamoDB::GlobalTable":
      properties = emitTable(r, ctx);
      break;
    default: {
      // 対応表（src/mapping）にある型は、宣言的な変換エンジンに任せる
      const spec = SPECS.get(r.type);
      if (spec) return emitFromSpec(r, spec, ctx);
      throw new CobolError("UNSUPPORTED-RESOURCE-TYPE", `未対応のリソース型です: ${r.type}`, r.line, r.col);
    }
  }
  return { Type: r.type, Properties: properties };
}
