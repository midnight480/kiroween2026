#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { compile, type CompileResult } from "./compile.js";
import { deploy, destroy, diff } from "./deploy.js";
import { CobolError } from "./errors.js";
import { eventLine, header, renderDeploy, renderDestroy, renderDiff } from "./report.js";
import { toYaml } from "./yaml.js";

const USAGE = `使い方: cobf [コマンド] <file.cbl> [オプション]

コマンド:
  compile   CloudFormation テンプレートを標準出力へ（副作用なし）
  deploy    ChangeSet を作成して実行し、スタックイベントを帳票に流す
  destroy   スタックを削除する
  diff      既存スタックとの差分を表示する（実行はしない）

コマンド省略時は .cbl の CALL "DEPLOY" / "DESTROY" を既定アクションにします。

オプション:
  --format json|yaml   compile の出力形式（既定: json）
  --yes, --force       確認プロンプトを省略する（CI 用）
`;

interface Args {
  command: string | undefined;
  file: string;
  format: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Args | number {
  const commands = new Set(["compile", "deploy", "destroy", "diff"]);
  const rest = [...argv];
  let command: string | undefined;
  if (rest[0] && commands.has(rest[0])) command = rest.shift();

  let file = "";
  let format = "json";
  let yes = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (a === "--format") {
      format = rest[++i] ?? "";
    } else if (a === "--yes" || a === "--force") {
      yes = true;
    } else if (a.startsWith("-")) {
      process.stderr.write(`未知のオプションです: ${a}\n`);
      return 2;
    } else if (file === "") {
      file = a;
    } else {
      process.stderr.write(`ファイルは 1 つだけ指定してください: ${a}\n`);
      return 2;
    }
  }
  if (file === "") {
    process.stderr.write(USAGE);
    return 2;
  }
  if (format !== "json" && format !== "yaml") {
    process.stderr.write(`--format は json か yaml です: ${format}\n`);
    return 2;
  }
  return { command, file, format, yes };
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
    process.stderr.write(`${file}${w.line !== undefined ? `:${w.line}` : ""}: 警告 ${w.code}: ${w.message}\n`);
  }
}

async function run(args: Args): Promise<number> {
  let source: string;
  try {
    source = readFileSync(args.file, "utf8");
  } catch {
    process.stderr.write(`ファイルを読めません: ${args.file}\n`);
    return 2;
  }

  let result: CompileResult;
  try {
    result = compile(source);
  } catch (e) {
    if (e instanceof CobolError) {
      process.stderr.write(`${args.file}:${e.line}:${e.col}: エラー ${e.code}: ${e.message}\n`);
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
    process.stderr.write(`${args.file}: エラー NO-REGION: デプロイには OBJECT-COMPUTER（例: AWS-AP-NORTHEAST-1）が必要です\n`);
    return 1;
  }

  const common = { stackName: result.stackName, region: result.region };
  const onEvent = (e: Parameters<typeof eventLine>[0]): void => {
    process.stdout.write(`${eventLine(e)}\n`);
  };

  if (command === "diff") {
    // 読み取り中心で確認は不要。ChangeSet は作るが実行せず、必ず消す
    process.stdout.write(`${header("DIFF DIVISION", common.stackName, common.region)}\n`);
    const out = renderDiff(await diff({ ...common, template: result.template }));
    process.stdout.write(`${out.text}\n`);
    return out.code;
  }

  if (command === "deploy") {
    if (!args.yes && !(await confirm(`${result.stackName} を ${result.region} にデプロイします。よろしいですか？`))) {
      process.stderr.write("中止しました（非対話の場合は --yes が必要です）\n");
      return 3;
    }
    process.stdout.write(`${header("DEPLOY DIVISION", common.stackName, common.region)}\n`);
    const out = renderDeploy(await deploy({ ...common, template: result.template, onEvent }));
    process.stdout.write(`${out.text}\n`);
    return out.code;
  }

  // destroy
  if (!args.yes && !(await confirm(`${result.stackName} を ${result.region} から削除します。元に戻せません。よろしいですか？`))) {
    process.stderr.write("中止しました（非対話の場合は --yes が必要です）\n");
    return 3;
  }
  process.stdout.write(`${header("DESTROY DIVISION", common.stackName, common.region)}\n`);
  const out = renderDestroy(await destroy({ ...common, onEvent }));
  process.stdout.write(`${out.text}\n`);
  return out.code;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stdout.write(USAGE);
    return 2;
  }
  if (argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  if (typeof args === "number") return args;
  return run(args);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`予期しないエラー: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
