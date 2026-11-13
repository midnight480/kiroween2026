import type { Json, Resource } from "../resolve.js";

/**
 * 対応表（COBOL → CloudFormation）の型。
 * リソース型ごとに「COBOL の項目名 → CFN のプロパティ → 型・必須・既定値」を宣言する。
 * 変換そのものは 1 つのエンジン（engine.ts）が行う。
 */
export type Kind =
  /** 文字列そのまま */
  | "string"
  /** PIC 9 の数値 */
  | "number"
  /** CFN が文字列で受ける数値（`AllocatedStorage`、ASG の `MinSize` など） */
  | "numstr"
  /** `"Y"` / `"N"` → true / false */
  | "bool"
  /** `REF:` / `GETATT:` を解決。それ以外は文字列のまま（既存リソースの ID を直書きできる） */
  | "ref"
  /** カンマ区切りの一覧。各要素で `REF:` / `GETATT:` を解決 */
  | "strings"
  /** `SSM:<パス>` / `SECRET:<ID>` を動的参照に変換。それ以外は文字列のまま（AMI の ID など） */
  | "ssm"
  /** `\n` を改行にして `Fn::Base64` で包む（EC2 の UserData） */
  | "userdata"
  /** パスワード。`SECRET:` / `SSM:` の動的参照だけ許す。平文はエラー */
  | "secret"
  /** カンマ区切りの ID 一覧 → `[{ "Id": ... }]`（ターゲットグループの Targets） */
  | "targets";

export interface Field {
  /** COBOL のデータ名（完全一致）。リスト内の項目では、末尾が一致する名前（接尾辞） */
  name: string;
  /** Properties 内のパス。`.` で入れ子、数字の区切りは配列の添字（例: `Origins.0.DomainName`） */
  cfn: string;
  kind: Kind;
  required?: boolean;
  /** 許す値。違反は INVALID-VALUE */
  enum?: readonly string[];
  /** 書かれていないときの値（Security by default などに使う） */
  default?: Json;
  /** 値の置き換え（`caching-optimized` → ポリシー ID など）。キーが許す値になる */
  map?: Record<string, Json>;
  /**
   * 公式スキーマ上のパス（`*` は配列の要素）。スキーマが中身を持たない `object`（RedrivePolicy、
   * ログの Options、PolicyDocument など）の中に値を置くときだけ、その親のパスを書く。
   */
  schemaPath?: string;
}

/** OCCURS の表 → オブジェクトの配列（SG のルール、CLB のリスナーなど） */
export interface ListSpec {
  /** OCCURS グループ名の接尾辞（例: `-INGRESS`） */
  group: string;
  cfn: string;
  /** 要素の項目。名前は接尾辞で、互いに他の接尾辞になってはいけない（テストで検査） */
  fields: Field[];
}

/** `post` フック用の道具。専用ロジックが必要な所だけに使う。 */
export interface Hook {
  readonly resource: Resource;
  readonly region: string | undefined;
  has(path: string): boolean;
  get(path: string): Json | undefined;
  set(path: string, value: Json): void;
  /** 書かれた COBOL の項目があるか（変換後のプロパティではなく入力側を見る） */
  wrote(name: string): boolean;
  warn(code: string, message: string): void;
  fail(code: string, message: string): never;
}

export interface ResourceSpec {
  type: string;
  fields: Field[];
  lists?: ListSpec[];
  /** `NAME-TAG` を `Tags: [{ Key: "Name", Value }]` に変換する */
  tags?: boolean;
  post?: (h: Hook) => void;
}

/** すべてのリソースで使える項目（リソース属性）。 */
export const GENERIC_FIELDS = ["RESOURCE-TYPE", "DEPENDS-ON", "DELETION-POLICY", "NAME-TAG"] as const;

/** `A.B.0.C` のようなパスに値を置く。数字の区切りは配列を作る。 */
export function setPath(root: Record<string, Json>, path: string, value: Json): void {
  const parts = path.split(".");
  let cur: Json = root;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i] as string;
    const last = i === parts.length - 1;
    const nextIsIndex = !last && /^\d+$/.test(parts[i + 1] as string);
    const slot = /^\d+$/.test(key) ? Number(key) : key;

    const container = cur as Record<string, Json> & Json[];
    if (last) {
      container[slot as never] = value as never;
      return;
    }
    let next = container[slot as never] as Json | undefined;
    if (next === undefined || next === null || typeof next !== "object") {
      next = nextIsIndex ? [] : {};
      container[slot as never] = next as never;
    }
    cur = next;
  }
}

export function getPath(root: Json, path: string): Json | undefined {
  let cur: Json | undefined = root;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, Json>)[key];
    if (cur === undefined) return undefined;
  }
  return cur;
}
