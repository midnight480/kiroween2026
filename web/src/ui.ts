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
