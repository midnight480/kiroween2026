import { CobolError, type Diagnostic } from "./errors.js";

/** 継続行の結合後の論理行。text は 8〜72 桁（B 領域込み）。 */
export interface LogicalLine {
  /** 先頭カードの行番号（1 始まり） */
  line: number;
  text: string;
}

export interface CardResult {
  lines: LogicalLine[];
  warnings: Diagnostic[];
}

const B_AREA_WIDTH = 72 - 7; // 8〜72 桁

/** 文字列リテラルが開いたままか（引用符が奇数個か）。 */
function hasOpenLiteral(text: string): boolean {
  let quotes = 0;
  for (const ch of text) if (ch === '"') quotes++;
  return quotes % 2 === 1;
}

/**
 * 固定形式カードリーダ（§4.2）。
 * 1–6 連番 / 7 標識 / 8–72 コード / 73–80 識別（無視）。
 */
export function readCards(source: string): CardResult {
  const lines: LogicalLine[] = [];
  const warnings: Diagnostic[] = [];
  const raw = source.split(/\r?\n/);

  raw.forEach((card, i) => {
    const lineNo = i + 1;

    const tab = card.indexOf("\t");
    if (tab >= 0) {
      throw new CobolError("TAB-FORBIDDEN", "タブ文字は使えません。パンチカードにタブはありません", lineNo, tab + 1);
    }
    if (card.length > 80) {
      throw new CobolError("LINE-TOO-LONG", `80 桁を超えています（${card.length} 桁）`, lineNo, 81);
    }
    if (card.slice(6).trim() === "") return; // 空行・連番だけの行

    if (card.length > 72 && card.slice(72).trim() !== "") {
      warnings.push({
        code: "IGNORED-COLUMNS",
        message: "73 桁目以降は読まれません",
        line: lineNo,
      });
    }

    const indicator = card[6] ?? " ";
    const body = card.slice(7, 72);

    switch (indicator) {
      case " ":
        lines.push({ line: lineNo, text: body });
        return;
      case "*":
      case "/":
        return; // コメント
      case "D":
        return; // デバッグ行（--debug 未指定のため読み飛ばし）
      case "-": {
        const prev = lines[lines.length - 1];
        if (!prev) {
          throw new CobolError("ORPHAN-CONTINUATION", "継続行の前に続けるべき行がありません", lineNo, 7);
        }
        if (!hasOpenLiteral(prev.text)) {
          throw new CobolError(
            "UNSUPPORTED-IN-MVP",
            "継続行は文字列リテラルの分割のみ対応しています",
            lineNo,
            7,
          );
        }
        const cont = body.trimStart();
        if (!cont.startsWith('"')) {
          throw new CobolError("CONTINUATION-QUOTE-MISSING", "継続行の最初の非空白は引用符 \" でなければなりません", lineNo, 12);
        }
        // COBOL の規則: 前行は 72 桁まで埋めて連結する
        prev.text = prev.text.padEnd(B_AREA_WIDTH, " ") + cont.slice(1);
        return;
      }
      default:
        throw new CobolError(
          "INVALID-INDICATOR",
          `7 桁目は空白・*・-・D・/ のみ使えます（'${indicator}' があります）。桁がずれていませんか`,
          lineNo,
          7,
        );
    }
  });

  return { lines, warnings };
}
