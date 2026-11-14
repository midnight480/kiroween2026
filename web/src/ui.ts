import type { Locale } from "../../src/i18n.js";

/** 画面の文言。英語を既定にし、日本語に切り替えられる。 */
export type UiKey =
  | "sample"
  | "soundOff"
  | "soundOn"
  | "soundTitle"
  | "editor"
  | "editorHint"
  | "editorLabel"
  | "printer"
  | "printerHint"
  | "printerLabel"
  | "statusOk"
  | "statusFail"
  | "footer"
  | "switchTo";

export const UI: Record<Locale, Record<UiKey, string>> = {
  en: {
    sample: "Sample",
    soundOff: "Sound: OFF",
    soundOn: "Sound: ON",
    soundTitle: "Toggle the dot-matrix printer sound",
    editor: "EDITOR",
    editorHint: "80 columns · col 7 = indicator · col 12 = Area B · col 72 = last",
    editorLabel: "COBOL source (fixed format)",
    printer: "LINE PRINTER",
    printerHint: "132-column continuous form",
    printerLabel: "Line printer output",
    statusOk: "Compiled: CloudFormation generated",
    statusFail: "Compile failed: the listing turned blood-red",
    footer:
      "Compilation runs entirely in this page, so no AWS credentials ever reach the browser. Deployment is done with the CLI (cobf deploy) or an authenticated backend.",
    switchTo: "日本語",
  },
  ja: {
    sample: "サンプル",
    soundOff: "音: OFF",
    soundOn: "音: ON",
    soundTitle: "ドットインパクト音の切り替え",
    editor: "EDITOR",
    editorHint: "80 桁 · 7 桁目 = 標識 · 12 桁目 = B 領域 · 72 桁目まで",
    editorLabel: "COBOL ソース（固定形式）",
    printer: "LINE PRINTER",
    printerHint: "132 桁連続帳票",
    printerLabel: "ラインプリンターの出力",
    statusOk: "コンパイル成功: CloudFormation を生成しました",
    statusFail: "コンパイル失敗: 帳票が血のインクになりました",
    footer: "コンパイルはこのページの中だけで動きます。AWS の鍵はブラウザに渡りません。デプロイは CLI（cobf deploy）か認証付きバックエンド経由です。",
    switchTo: "English",
  },
};

export function pickLocale(search: string): Locale {
  const value = new URLSearchParams(search).get("lang");
  return value === "ja" ? "ja" : "en";
}
/** 動画撮影用: `?hl=1-6`（桁の範囲）や `?hl=7`（1 桁）で、エディタの桁を帯で強調する。範囲が不正なら undefined。 */
export interface Highlight {
  from: number;
  to: number;
  caption: string;
}
const COLUMN_CAPTIONS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 6, "Columns 1-6: sequence number"],
  [7, 7, "Column 7: indicator"],
  [8, 11, "Columns 8-11: Area A"],
  [12, 72, "Columns 12-72: Area B"],
  [73, 80, "Columns 73-80: identification"],
];
export function parseHighlight(search: string): Highlight | undefined {
  const value = new URLSearchParams(search).get("hl");
  const m = value === null ? null : /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(value);
  if (!m) return undefined;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (from < 1 || to > 80 || from > to) return undefined;
  const hit = COLUMN_CAPTIONS.find(([a, b]) => a === from && b === to);
  return { from, to, caption: hit ? hit[2] : to === from ? `Column ${from}` : `Columns ${from}-${to}` };
}
