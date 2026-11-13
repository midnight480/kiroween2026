/** 行・桁つきのコンパイルエラー（設計書 §7 / §9.1）。 */
export class CobolError extends Error {
  readonly code: string;
  readonly line: number;
  readonly col: number;

  constructor(code: string, message: string, line: number, col: number) {
    super(message);
    this.name = "CobolError";
    this.code = code;
    this.line = line;
    this.col = col;
  }
}

export interface Diagnostic {
  code: string;
  message: string;
  line?: number;
}

/**
 * パロディのメッセージ番号（§7）。実在する IBM のメッセージ ID（IGYxxxx 等）は流用せず、
 * 独自の接頭辞 `CBF` を使う。順序を変えると番号が変わるので、追加は末尾に足すこと。
 */
const CODES = [
  "TAB-FORBIDDEN",
  "LINE-TOO-LONG",
  "INVALID-INDICATOR",
  "ORPHAN-CONTINUATION",
  "CONTINUATION-QUOTE-MISSING",
  "UNTERMINATED-LITERAL",
  "LOWERCASE-NOT-ALLOWED",
  "UNEXPECTED-CHARACTER",
  "SYNTAX",
  "EXPECTED-LITERAL",
  "INVALID-LEVEL",
  "INVALID-LEVEL-88",
  "MISSING-PROGRAM-ID",
  "UNSUPPORTED-IN-MVP",
  "PIC-OVERFLOW",
  "UNDEFINED-NAME",
  "AMBIGUOUS-NAME",
  "SUBSCRIPT-REQUIRED",
  "SUBSCRIPT-OUT-OF-RANGE",
  "SUBSCRIPT-NOT-ALLOWED",
  "INVALID-REGION",
  "UNSUPPORTED-RESOURCE-TYPE",
  "DUPLICATE-RESOURCE",
  "DBLINK-RETIRED",
  "UNKNOWN-DB-ENGINE",
  "UNDEFINED-REFERENCE",
  "INVALID-REFERENCE",
  "CIRCULAR-REFERENCE",
  "MISSING-PROPERTY",
  "INVALID-MANAGED-POLICY",
  "INVALID-CODE-LOCATION",
  "MISSING-FD",
  "MISSING-KEY",
  "MISSING-REGIONS",
  "DUPLICATE-REGION",
  "STACK-REGION-NOT-A-REPLICA",
  "SEQUENCE-ERROR",
  // 以降は警告（W）
  "MISSING-STOP-RUN",
  "MISSING-PERIOD",
  "IGNORED-COLUMNS",
  "NO-REGION",
  "NO-CODE",
  "WILDCARD-ACTION",
  "PUBLIC-ACCESS-ALLOWED",
  "REGION-SET",
  "DISPLAY-IGNORED",
  // 対応表（src/mapping）で増えたもの
  "INVALID-VALUE",
  "UNKNOWN-PROPERTY",
  "PLAIN-PASSWORD",
  "CLOUDFRONT-CERT-REGION",
  "OPEN-TO-THE-WORLD",
  "CDN-NO-ALIAS",
  "IMDSV1-ENABLED",
  "ALB-NO-SG",
  "CLASSIC-LB",
  "DB-PUBLIC",
  "DB-UNENCRYPTED",
  "CLASSIC-THREE-TIER",
] as const;

export const KNOWN_ERROR_CODES: readonly string[] = CODES;

/** 例: `LOWERCASE-NOT-ALLOWED` → `CBF-0007-S`。未登録は `CBF-9999-S`。 */
export function messageId(code: string, severity: "S" | "W" = "S"): string {
  const i = CODES.indexOf(code as (typeof CODES)[number]);
  const n = i < 0 ? 9999 : i + 1;
  return `CBF-${String(n).padStart(4, "0")}-${severity}`;
}

/** IBM 風の重大度。エラーは 12（SEVERE）、警告は 4。 */
export const SEVERITY_ERROR = 12;
export const SEVERITY_WARNING = 4;

/** 小文字だけは決め台詞つき（§7）。それ以外は事実のメッセージのまま。 */
function headline(e: CobolError): string {
  if (e.code === "LOWERCASE-NOT-ALLOWED") return `LOWERCASE IS HERESY — ${e.message}`;
  if (e.code === "SEQUENCE-ERROR") return `THE CARD DECK IS OUT OF ORDER — ${e.message}`;
  return e.message;
}

export function formatError(file: string, e: CobolError): string {
  return `${file}:${e.line}:${e.col}: ${messageId(e.code)} SEVERITY ${SEVERITY_ERROR}: ${headline(e)} [${e.code}]`;
}

export function formatWarning(file: string, w: Diagnostic): string {
  const where = w.line !== undefined ? `${file}:${w.line}` : file;
  return `${where}: ${messageId(w.code, "W")} SEVERITY ${SEVERITY_WARNING}: ${w.message} [${w.code}]`;
}
