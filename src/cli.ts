#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { compile, type CompileResult } from "./compile.js";
import { deploy, destroy, diff } from "./deploy.js";
import { CobolError, formatError, formatWarning } from "./errors.js";
import { localize, setLocale, type Locale } from "./i18n.js";
import { header, Ledger, renderDeploy, renderDestroy, renderDiff } from "./report.js";
import { toYaml } from "./yaml.js";

type Text = Record<"usage" | "unknownOption" | "oneFile" | "badFormat" | "badLang" | "cannotRead" | "noRegion" | "confirmDeploy" | "confirmDestroy" | "aborted" | "unexpected", string>;

const TEXT: Record<Locale, Text> = {
  ja: {
    usage: `使い方: cobf [コマンド] <file.cbl> [オプション]

コマンド:
  compile   CloudFormation テンプレートを標準出力へ（副作用なし）
  deploy    ChangeSet を作成して実行し、スタックイベントを帳票に流す
  destroy   スタックを削除する
  diff      既存スタックとの差分を表示する（実行はしない）

コマンド省略時は .cbl の CALL "DEPLOY" / "DESTROY" を既定アクションにします。

オプション:
  --format json|yaml   compile の出力形式（既定: json）
  --yes, --force       確認プロンプトを省略する（CI 用）
  --strict-sequence    1〜6 桁目の連番が昇順でなければエラーにする
  --lang en|ja         メッセージの言語（既定: 環境変数 COBF_LANG、無ければロケール）
`,
    unknownOption: "未知のオプションです: {0}",
    oneFile: "ファイルは 1 つだけ指定してください: {0}",
    badFormat: "--format は json か yaml です: {0}",
    badLang: "--lang は en か ja です: {0}",
    cannotRead: "ファイルを読めません: {0}",
    noRegion: "{0}: エラー NO-REGION: デプロイには OBJECT-COMPUTER（例: AWS-AP-NORTHEAST-1）が必要です",
    confirmDeploy: "{0} を {1} にデプロイします。よろしいですか？",
    confirmDestroy: "{0} を {1} から削除します。元に戻せません。よろしいですか？",
    aborted: "中止しました（非対話の場合は --yes が必要です）",
    unexpected: "予期しないエラー: {0}",
  },
  en: {
    usage: `Usage: cobf [command] <file.cbl> [options]

Commands:
  compile   Print the CloudFormation template to stdout (no side effects)
  deploy    Create and execute a ChangeSet, streaming stack events to the report
  destroy   Delete the stack
  diff      Show the changes against the existing stack (never executes them)

Without a command, the CALL "DEPLOY" / "DESTROY" in the .cbl file is the default action.

Options:
  --format json|yaml   Output format for compile (default: json)
  --yes, --force       Skip the confirmation prompt (for CI)
  --strict-sequence    Fail if the sequence numbers in columns 1-6 do not ascend
  --lang en|ja         Message language (default: COBF_LANG, then the locale)
`,
    unknownOption: "Unknown option: {0}",
    oneFile: "Give exactly one file: {0}",
    badFormat: "--format must be json or yaml: {0}",
    badLang: "--lang must be en or ja: {0}",
    cannotRead: "Cannot read the file: {0}",
    noRegion: "{0}: error NO-REGION: deploying needs an OBJECT-COMPUTER (for example AWS-AP-NORTHEAST-1)",
    confirmDeploy: "Deploy {0} to {1}. Continue?",
    confirmDestroy: "Delete {0} from {1}. This cannot be undone. Continue?",
    aborted: "Aborted (a non-interactive run needs --yes)",
    unexpected: "Unexpected error: {0}",
  },
};

/** `{0}` `{1}` を引数で置き換える。 */
function say(key: keyof Text, ...args: string[]): string {
  const locale = currentLocale;
  return TEXT[locale][key].replace(/\{(\d+)\}/g, (_, i: string) => args[Number(i)] ?? "");
}

let currentLocale: Locale = "ja";

/** --lang、COBF_LANG、ロケールの順に決める。日本語のロケール以外は英語。 */
function detectLocale(flag: string | undefined): Locale | undefined {
  const pick = (v: string | undefined): Locale | undefined => (v === "en" || v === "ja" ? v : undefined);
  const fromFlag = pick(flag);
  if (fromFlag) return fromFlag;
  const fromEnv = pick(process.env["COBF_LANG"]);
  if (fromEnv) return fromEnv;
  const locale = process.env["LC_ALL"] ?? process.env["LC_MESSAGES"] ?? process.env["LANG"] ?? "";
  return locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

interface Args {
  command: string | undefined;
  file: string;
  format: string;
  yes: boolean;
  strictSequence: boolean;
  lang: string | undefined;
}

function parseArgs(argv: string[]): Args | number {
  const commands = new Set(["compile", "deploy", "destroy", "diff"]);
  const rest = [...argv];
  let command: string | undefined;
  if (rest[0] && commands.has(rest[0])) command = rest.shift();

  let file = "";
  let format = "json";
  let yes = false;
  let strictSequence = false;
  let lang: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (a === "--format") {
      format = rest[++i] ?? "";
    } else if (a === "--yes" || a === "--force") {
      yes = true;
    } else if (a === "--strict-sequence") {
      strictSequence = true;
    } else if (a === "--lang") {
      lang = rest[++i] ?? "";
    } else if (a.startsWith("-")) {
      process.stderr.write(`${say("unknownOption", a)}\n`);
      return 2;
    } else if (file === "") {
      file = a;
    } else {
      process.stderr.write(`${say("oneFile", a)}\n`);
      return 2;
    }
  }
  if (file === "") {
    process.stderr.write(say("usage"));
    return 2;
  }
  if (format !== "json" && format !== "yaml") {
    process.stderr.write(`${say("badFormat", format)}\n`);
    return 2;
  }
  return { command, file, format, yes, strictSequence, lang };
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // 非対話では勝手に進めない。--yes が必要
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function printWarnings(file: string, result: CompileResult): void {
  for (const w of result.warnings) {
    process.stderr.write(`${formatWarning(file, w)}\n`);
  }
}

async function run(args: Args): Promise<number> {
  let source: string;
  try {
    source = readFileSync(args.file, "utf8");
  } catch {
    process.stderr.write(`${say("cannotRead", args.file)}\n`);
    return 2;
  }

  let result: CompileResult;
  try {
    result = compile(source, { strictSequence: args.strictSequence });
  } catch (e) {
    if (e instanceof CobolError) {
      process.stderr.write(`${formatError(args.file, e)}\n`);
      return 1;
    }
    throw e;
  }
  printWarnings(args.file, result);

  // 優先順位（§4.6）: CLI 明示 > .cbl の CALL > compile
  const fromCall = result.intent === "DEPLOY" ? "deploy" : result.intent === "DESTROY" ? "destroy" : undefined;
  const command = args.command ?? fromCall ?? "compile";

  if (command === "compile") {
    process.stdout.write(args.format === "yaml" ? toYaml(result.template) : `${JSON.stringify(result.template, null, 2)}\n`);
    return 0;
  }
  // diff / deploy / destroy はリージョンが必須（§4.5 規則 3）
  if (result.region === undefined) {
    process.stderr.write(`${say("noRegion", args.file)}\n`);
    return 1;
  }

  const common = { stackName: result.stackName, region: result.region };
  const ledger = (title: string): Ledger => new Ledger(title, common.stackName, common.region);

  if (command === "diff") {
    // 読み取り中心で確認は不要。ChangeSet は作るが実行せず、必ず消す
    process.stdout.write(`${header("DIFF DIVISION", common.stackName, common.region)}\n`);
    const out = renderDiff(await diff({ ...common, template: result.template }));
    process.stdout.write(`${out.text}\n`);
    return out.code;
  }

  if (command === "deploy") {
    if (!args.yes && !(await confirm(say("confirmDeploy", result.stackName, result.region)))) {
      process.stderr.write(`${say("aborted")}\n`);
      return 3;
    }
    const book = ledger("DEPLOY DIVISION");
    process.stdout.write(`${book.start()}\n`);
    const out = renderDeploy(
      await deploy({ ...common, template: result.template, onEvent: (e) => process.stdout.write(`${book.event(e)}\n`) }),
    );
    process.stdout.write(`${out.text}\n${book.footer()}\n`);
    return out.code;
  }

  // destroy
  if (!args.yes && !(await confirm(say("confirmDestroy", result.stackName, result.region)))) {
    process.stderr.write(`${say("aborted")}\n`);
    return 3;
  }
  const book = ledger("DESTROY DIVISION");
  process.stdout.write(`${book.start()}\n`);
  const out = renderDestroy(await destroy({ ...common, onEvent: (e) => process.stdout.write(`${book.event(e)}\n`) }));
  process.stdout.write(`${out.text}\n${book.footer()}\n`);
  return out.code;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // 引数の解析中のエラーも読めるように、先に環境から言語を決める。--lang があれば、その後で上書きする
  const flagAt = argv.indexOf("--lang");
  // 不正な --lang の値は無視して環境から決め、そのエラーを環境の言語で伝える
  currentLocale = detectLocale(flagAt >= 0 ? argv[flagAt + 1] : undefined) ?? "en";
  setLocale(currentLocale);
  if (argv.length === 0) {
    process.stdout.write(say("usage"));
    return 2;
  }
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(say("usage"));
    return 0;
  }
  const args = parseArgs(argv);
  if (typeof args === "number") return args;
  if (args.lang !== undefined && args.lang !== "en" && args.lang !== "ja") {
    process.stderr.write(`${say("badLang", args.lang)}\n`);
    return 2;
  }
  return run(args);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`${say("unexpected", e instanceof Error ? e.message : String(e))}\n`);
    process.exitCode = 1;
  },
);
