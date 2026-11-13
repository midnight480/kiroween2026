import { CobolError, type Diagnostic } from "./errors.js";
import type { Token } from "./lexer.js";

export type Literal = string | number;

export interface Pic {
  kind: "X" | "9";
  length: number;
}

export interface DataItem {
  level: number;
  name: string;
  pic?: Pic;
  value?: Literal;
  occurs?: number;
  /** MOVE で上書きされた値。キーは添字（添字なしは 0）。最後の MOVE が勝つ（§4.8） */
  moved: Map<number, Literal>;
  children: DataItem[];
  /** 88 レベル条件名 */
  conditions: { name: string; value: Literal }[];
  parent?: DataItem;
  line: number;
  col: number;
}

export interface SelectEntry {
  name: string;
  assignTo: string;
  organization?: string;
  recordKey?: string;
  alternateKeys: { name: string; duplicates: boolean }[];
  fileStatus?: string;
  line: number;
  col: number;
}

export interface FileDescription {
  name: string;
  record: DataItem[];
}

export type Statement =
  | { kind: "move"; value: Literal; target: string; subscript?: number; line: number; col: number }
  | { kind: "call"; target: string; line: number; col: number }
  | { kind: "display"; line: number; col: number }
  | { kind: "stop"; line: number; col: number }
  | { kind: "goback"; line: number; col: number };

export interface Program {
  programId: string;
  author?: string;
  sourceComputer?: string;
  objectComputer?: string;
  objectComputerLine?: number;
  selects: SelectEntry[];
  fds: FileDescription[];
  workingStorage: DataItem[];
  procedure: Statement[];
  /** PROCEDURE DIVISION が書かれているか */
  hasProcedure: boolean;
  warnings: Diagnostic[];
}

const CLAUSE_KEYWORDS = new Set(["PIC", "PICTURE", "VALUE", "VALUES", "OCCURS", "USAGE", "REDEFINES"]);
const DIVISIONS = new Set(["IDENTIFICATION", "ENVIRONMENT", "DATA", "PROCEDURE"]);

type Sentence = Token[];

function splitSentences(tokens: Token[], warnings: Diagnostic[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    if (t.kind === "period") {
      if (cur.length > 0) out.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length > 0) {
    const first = cur[0] as Token;
    warnings.push({ code: "MISSING-PERIOD", message: "最後の文の終端ピリオドがありません", line: first.line });
    out.push(cur);
  }
  return out;
}

// Token を渡したときは単なる boolean、Token | undefined のときは型ガードにする
function isWord(t: Token, value?: string): boolean;
function isWord(t: Token | undefined, value?: string): t is Token;
function isWord(t: Token | undefined, value?: string): boolean {
  return t !== undefined && t.kind === "word" && (value === undefined || t.value === value);
}

/** `PROGRAM-ID. 名前.` のように、見出し語の後ろのピリオドで文が分かれる段落 */
const PARAGRAPH_HEADERS = new Set(["PROGRAM-ID", "AUTHOR", "SOURCE-COMPUTER", "OBJECT-COMPUTER"]);

/** PIC 文字列 "X(20)" / "XX" / "9(9)" → Pic */
function parsePic(text: string, at: Token): Pic {
  const m = /^([X9])(?:\((\d+)\))?$/.exec(text);
  if (m) {
    const len = m[2] === undefined ? 1 : Number(m[2]);
    return { kind: m[1] as "X" | "9", length: len };
  }
  const rep = /^(X+|9+)$/.exec(text);
  if (rep) {
    return { kind: (rep[1] as string)[0] as "X" | "9", length: (rep[1] as string).length };
  }
  throw new CobolError("UNSUPPORTED-IN-MVP", `この PIC 句は MVP では扱えません: ${text}`, at.line, at.col);
}

function literalOf(t: Token | undefined, what: string): Literal {
  if (t && t.kind === "string") return t.value;
  if (t && t.kind === "number") return Number(t.value);
  const at = t ?? { line: 0, col: 0 };
  throw new CobolError("EXPECTED-LITERAL", `${what} にはリテラルが必要です`, at.line, at.col);
}

function parseDataSentence(s: Sentence, stack: DataItem[], roots: DataItem[]): void {
  const first = s[0] as Token;
  const level = Number(first.value);
  let idx = 1;

  let name = "FILLER";
  const second = s[1];
  if (isWord(second) && !CLAUSE_KEYWORDS.has(second.value)) {
    name = second.value;
    idx = 2;
  }

  const item: DataItem = {
    level,
    name,
    moved: new Map(),
    children: [],
    conditions: [],
    line: first.line,
    col: first.col,
  };

  while (idx < s.length) {
    const t = s[idx] as Token;
    if (isWord(t, "PIC") || isWord(t, "PICTURE")) {
      idx++;
      if (isWord(s[idx], "IS")) idx++;
      let text = "";
      while (idx < s.length && !(isWord(s[idx]) && CLAUSE_KEYWORDS.has((s[idx] as Token).value))) {
        text += (s[idx] as Token).value;
        idx++;
      }
      item.pic = parsePic(text, t);
    } else if (isWord(t, "VALUE") || isWord(t, "VALUES")) {
      idx++;
      if (isWord(s[idx], "IS") || isWord(s[idx], "ARE")) idx++;
      item.value = literalOf(s[idx], "VALUE");
      idx++;
    } else if (isWord(t, "OCCURS")) {
      idx++;
      const n = s[idx];
      if (!n || n.kind !== "number") {
        throw new CobolError("EXPECTED-LITERAL", "OCCURS には回数が必要です", t.line, t.col);
      }
      item.occurs = Number(n.value);
      idx++;
      if (isWord(s[idx], "TIMES")) idx++;
    } else {
      throw new CobolError("UNSUPPORTED-IN-MVP", `この句は MVP では扱えません: ${t.value}`, t.line, t.col);
    }
  }

  if (level === 88) {
    const owner = stack[stack.length - 1];
    if (!owner || item.value === undefined) {
      throw new CobolError("INVALID-LEVEL-88", "88 レベルは親項目と VALUE が必要です", first.line, first.col);
    }
    owner.conditions.push({ name: item.name, value: item.value });
    return;
  }

  if (level === 1 || level === 77) {
    stack.length = 0;
    roots.push(item);
  } else {
    while (stack.length > 0 && (stack[stack.length - 1] as DataItem).level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) {
      throw new CobolError("INVALID-LEVEL", `レベル ${level} の親項目（01）がありません`, first.line, first.col);
    }
    item.parent = parent;
    parent.children.push(item);
  }
  stack.push(item);
}

function parseSelect(s: Sentence): SelectEntry {
  const first = s[0] as Token;
  const nameTok = s[1];
  if (!isWord(nameTok)) {
    throw new CobolError("SYNTAX", "SELECT の後にファイル名が必要です", first.line, first.col);
  }
  const entry: SelectEntry = { name: nameTok.value, assignTo: "", alternateKeys: [], line: first.line, col: first.col };

  let i = 2;
  const skip = (...words: string[]) => {
    while (i < s.length && isWord(s[i]) && words.includes((s[i] as Token).value)) i++;
  };
  const wordAt = (): string => {
    const t = s[i];
    if (!isWord(t)) throw new CobolError("SYNTAX", "名前が必要です", (t ?? first).line, (t ?? first).col);
    i++;
    return t.value;
  };

  while (i < s.length) {
    const t = s[i] as Token;
    if (isWord(t, "ASSIGN")) {
      i++;
      skip("TO");
      const lit = s[i];
      if (!lit || lit.kind !== "string") {
        throw new CobolError("SYNTAX", "ASSIGN TO には外部名のリテラルが必要です", t.line, t.col);
      }
      entry.assignTo = lit.value;
      i++;
    } else if (isWord(t, "ORGANIZATION")) {
      i++;
      skip("IS");
      entry.organization = wordAt();
    } else if (isWord(t, "ACCESS")) {
      i++;
      skip("MODE");
      skip("IS");
      wordAt();
    } else if (isWord(t, "RECORD")) {
      i++;
      skip("KEY");
      skip("IS");
      entry.recordKey = wordAt();
    } else if (isWord(t, "ALTERNATE")) {
      i++;
      skip("RECORD");
      skip("KEY");
      skip("IS");
      const key = wordAt();
      let duplicates = false;
      if (isWord(s[i], "WITH")) {
        i++;
        if (isWord(s[i], "DUPLICATES")) {
          duplicates = true;
          i++;
        }
      }
      entry.alternateKeys.push({ name: key, duplicates });
    } else if (isWord(t, "FILE")) {
      i++;
      skip("STATUS");
      skip("IS");
      entry.fileStatus = wordAt();
    } else {
      throw new CobolError("UNSUPPORTED-IN-MVP", `SELECT 句は MVP では扱えません: ${t.value}`, t.line, t.col);
    }
  }

  if (entry.assignTo === "") {
    throw new CobolError("SYNTAX", "SELECT には ASSIGN TO が必要です", first.line, first.col);
  }
  return entry;
}

function parseStatement(s: Sentence, warnings: Diagnostic[]): Statement | undefined {
  const first = s[0] as Token;
  const { line, col } = first;
  switch (first.value) {
    case "MOVE": {
      const value = literalOf(s[1], "MOVE");
      if (!isWord(s[2], "TO") || !isWord(s[3])) {
        throw new CobolError("SYNTAX", "MOVE <リテラル> TO <データ名> の形式で書いてください", line, col);
      }
      const target = (s[3] as Token).value;
      let subscript: number | undefined;
      if (s[4]?.kind === "lparen") {
        const n = s[5];
        if (!n || n.kind !== "number" || s[6]?.kind !== "rparen") {
          throw new CobolError("UNSUPPORTED-IN-MVP", "添字は定数のみ対応しています", line, col);
        }
        subscript = Number(n.value);
        if (s.length > 7) throw new CobolError("UNSUPPORTED-IN-MVP", "MOVE の複数ターゲットは対応していません", line, col);
      } else if (s.length > 4) {
        throw new CobolError("UNSUPPORTED-IN-MVP", "MOVE の複数ターゲットは対応していません", line, col);
      }
      return subscript === undefined
        ? { kind: "move", value, target, line, col }
        : { kind: "move", value, target, subscript, line, col };
    }
    case "CALL": {
      const t = s[1];
      if (!t || t.kind !== "string") {
        throw new CobolError("SYNTAX", 'CALL にはリテラルが必要です（例: CALL "DEPLOY"）', line, col);
      }
      return { kind: "call", target: t.value, line, col };
    }
    case "DISPLAY":
      warnings.push({ code: "DISPLAY-IGNORED", message: "DISPLAY（Outputs 連携）は未実装のため無視します", line });
      return { kind: "display", line, col };
    case "STOP":
      return { kind: "stop", line, col };
    case "GOBACK":
      return { kind: "goback", line, col };
    default:
      return undefined;
  }
}

export function parse(tokens: Token[], inheritedWarnings: Diagnostic[] = []): Program {
  const warnings: Diagnostic[] = [...inheritedWarnings];
  const sentences = splitSentences(tokens, warnings);

  const program: Program = {
    programId: "",
    selects: [],
    fds: [],
    workingStorage: [],
    procedure: [],
    hasProcedure: false,
    warnings,
  };

  let division = "";
  let section = "";
  let currentFd: FileDescription | undefined;
  const wsStack: DataItem[] = [];
  const fdStack: DataItem[] = [];
  let pendingHeader: Token | undefined;

  for (const s of sentences) {
    const t0 = s[0] as Token;
    const t1 = s[1];

    // 直前が `PROGRAM-ID.` などの見出しだけの文なら、この文がその値
    if (pendingHeader) {
      const header = pendingHeader.value;
      pendingHeader = undefined;
      if (header === "PROGRAM-ID") program.programId = t0.value;
      else if (header === "AUTHOR") program.author = s.map((t) => t.value).join(" ");
      else if (header === "SOURCE-COMPUTER") program.sourceComputer = t0.value;
      else if (header === "OBJECT-COMPUTER") {
        program.objectComputer = t0.value;
        program.objectComputerLine = t0.line;
      }
      continue;
    }
    if (
      s.length === 1 &&
      isWord(t0) &&
      PARAGRAPH_HEADERS.has(t0.value) &&
      (division === "IDENTIFICATION" || division === "ENVIRONMENT")
    ) {
      pendingHeader = t0;
      continue;
    }

    // --- 見出し ---
    if (isWord(t0) && isWord(t1, "DIVISION")) {
      if (!DIVISIONS.has(t0.value)) {
        throw new CobolError("SYNTAX", `未知の DIVISION です: ${t0.value}`, t0.line, t0.col);
      }
      division = t0.value;
      if (division === "PROCEDURE") program.hasProcedure = true;
      section = "";
      continue;
    }
    if (isWord(t0) && isWord(t1, "SECTION")) {
      section = t0.value;
      continue;
    }
    if (isWord(t0, "FILE-CONTROL")) {
      section = "FILE-CONTROL";
      continue;
    }

    switch (division) {
      case "IDENTIFICATION": {
        if (isWord(t0, "PROGRAM-ID") && isWord(t1)) program.programId = t1.value;
        else if (isWord(t0, "AUTHOR") && t1) {
          program.author = s
            .slice(1)
            .map((t) => t.value)
            .join(" ");
        }
        break;
      }
      case "ENVIRONMENT": {
        if (isWord(t0, "SOURCE-COMPUTER") && isWord(t1)) program.sourceComputer = t1.value;
        else if (isWord(t0, "OBJECT-COMPUTER") && isWord(t1)) {
          program.objectComputer = t1.value;
          program.objectComputerLine = t0.line;
        } else if (isWord(t0, "SELECT")) program.selects.push(parseSelect(s));
        break;
      }
      case "DATA": {
        if (section === "FILE" && isWord(t0, "FD") && isWord(t1)) {
          currentFd = { name: t1.value, record: [] };
          program.fds.push(currentFd);
          fdStack.length = 0;
        } else if (t0.kind === "number") {
          if (section === "FILE") {
            if (!currentFd) throw new CobolError("SYNTAX", "FD の前にレコード定義があります", t0.line, t0.col);
            parseDataSentence(s, fdStack, currentFd.record);
          } else if (section === "WORKING-STORAGE") {
            parseDataSentence(s, wsStack, program.workingStorage);
          } else {
            throw new CobolError("UNSUPPORTED-IN-MVP", `${section || "(無名)"} SECTION は MVP では扱えません`, t0.line, t0.col);
          }
        } else {
          throw new CobolError("SYNTAX", `DATA DIVISION で解釈できない文です: ${t0.value}`, t0.line, t0.col);
        }
        break;
      }
      case "PROCEDURE": {
        const stmt = parseStatement(s, warnings);
        if (stmt) {
          program.procedure.push(stmt);
        } else if (s.length === 1 && isWord(t0)) {
          // 段落名
        } else {
          throw new CobolError("UNSUPPORTED-IN-MVP", `この文は MVP では扱えません: ${t0.value}`, t0.line, t0.col);
        }
        break;
      }
      default:
        throw new CobolError("SYNTAX", "DIVISION の外に文があります", t0.line, t0.col);
    }
  }

  if (program.programId === "") {
    throw new CobolError("MISSING-PROGRAM-ID", "PROGRAM-ID がありません", 1, 8);
  }
  // STOP RUN / GOBACK が無いと本物の COBOL ではジョブが終わらない（§7 の演出）
  if (program.hasProcedure && !program.procedure.some((st) => st.kind === "stop" || st.kind === "goback")) {
    warnings.push({
      code: "MISSING-STOP-RUN",
      message: "STOP RUN がありません。このジョブは終了しません（JOB DID NOT TERMINATE — 夜間バッチが朝まで回り続けます）",
    });
  }
  return program;
}
