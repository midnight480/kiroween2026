import { CobolError } from "./errors.js";
import type { LogicalLine } from "./card.js";

export type TokenKind = "word" | "string" | "number" | "lparen" | "rparen" | "period";

export interface Token {
  kind: TokenKind;
  /** string は引用符を除いた中身、それ以外は原文 */
  value: string;
  line: number;
  /** 桁（8 桁目起点。継続行結合後は近似） */
  col: number;
}

const WORD_CHAR = /[A-Za-z0-9_-]/;
const COL_BASE = 8;

export function lex(lines: LogicalLine[]): Token[] {
  const tokens: Token[] = [];

  for (const { line, text } of lines) {
    let i = 0;
    while (i < text.length) {
      const ch = text[i] as string;
      const col = COL_BASE + i;

      if (ch === " ") {
        i++;
      } else if (ch === '"') {
        let j = i + 1;
        let value = "";
        let closed = false;
        while (j < text.length) {
          if (text[j] === '"') {
            if (text[j + 1] === '"') {
              value += '"'; // "" は引用符 1 文字
              j += 2;
              continue;
            }
            closed = true;
            break;
          }
          value += text[j];
          j++;
        }
        if (!closed) {
          throw new CobolError("UNTERMINATED-LITERAL", "文字列リテラルが閉じていません", line, col);
        }
        tokens.push({ kind: "string", value, line, col });
        i = j + 1;
      } else if (ch === "(") {
        tokens.push({ kind: "lparen", value: ch, line, col });
        i++;
      } else if (ch === ")") {
        tokens.push({ kind: "rparen", value: ch, line, col });
        i++;
      } else if (ch === ".") {
        tokens.push({ kind: "period", value: ch, line, col });
        i++;
      } else if (WORD_CHAR.test(ch)) {
        let j = i;
        while (j < text.length && WORD_CHAR.test(text[j] as string)) j++;
        let word = text.slice(i, j);
        if (/[a-z]/.test(word)) {
          throw new CobolError(
            "LOWERCASE-NOT-ALLOWED",
            `予約語・データ名は大文字で書いてください: ${word}`,
            line,
            col + word.search(/[a-z]/),
          );
        }
        if (/^\d+$/.test(word) && text[j] === "." && /\d/.test(text[j + 1] ?? "")) {
          // 小数 (例 1.5)
          let k = j + 1;
          while (k < text.length && /\d/.test(text[k] as string)) k++;
          word = text.slice(i, k);
          j = k;
        }
        tokens.push({ kind: /^\d+(\.\d+)?$/.test(word) ? "number" : "word", value: word, line, col });
        i = j;
      } else {
        throw new CobolError("UNEXPECTED-CHARACTER", `解釈できない文字です: '${ch}'`, line, col);
      }
    }
  }

  return tokens;
}
