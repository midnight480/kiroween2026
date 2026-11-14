#!/usr/bin/env node
// デモ動画を作る（台本 → ナレーション → 画面 → mp4 + 字幕）。追加の依存なし:
//   macOS の `say`、ffmpeg/ffprobe、Google Chrome（headless でスクリーンショット）、Node の標準ライブラリだけ。
// 使い方: npm run video            全部作る（video/out/demo.mp4）
//         npm run video -- --check 台本と場面の対応・文字数だけ確認する（音声も映像も作らない）
// AWS には触らない。実デプロイの映像は video/clips/*.mp4 に自分で撮って置く（無ければ目印のカードが入る）。
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "video", "out");
const W = 1920;
const H = 1080;
const FPS = 30;
// 画面は 1280x720 の CSS ピクセルで描き、1.5 倍で撮って 1920x1080 にする（1080p でも文字が読める大きさになる）
const DPR = 1.5;
const VW = W / DPR;
const VH = H / DPR;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const checkOnly = process.argv.includes("--check");

const config = JSON.parse(readFileSync(join(ROOT, "video", "scenes.json"), "utf8"));
const warnings = [];

// ---------------------------------------------------------------- 台本（docs/DEMO_SCRIPT.md）からナレーションを読む

function readNarration() {
  const md = readFileSync(join(ROOT, "docs", "DEMO_SCRIPT.md"), "utf8");
  const part = md.split("## ナレーション（場面ごと）")[1]?.split(/\n## /)[0] ?? "";
  const found = new Map();
  const re = /\*\*(\d+)\.[^\n]*\*\*\s*\n\s*\n>\s*([^\n]+)/g;
  for (const m of part.matchAll(re)) found.set(Number(m[1]), m[2].trim());
  return found;
}

const narration = readNarration();
for (const s of config.scenes) {
  if (!narration.has(s.n)) throw new Error(`台本に場面 ${s.n} のナレーションが見つかりません（docs/DEMO_SCRIPT.md）`);
}
const words = [...narration.values()].join(" ").split(/\s+/).length;
console.log(`台本: ${config.scenes.length} 場面、ナレーション ${words} 語`);
if (checkOnly) process.exit(0);

// ---------------------------------------------------------------- 道具

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.slice(0, 4).join(" ")} … が失敗 (exit ${r.status})\n${(r.stderr || r.stdout || "").slice(-1500)}`);
  }
  return r;
}
const ff = (...args) => run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const duration = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout.trim());
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

for (const bin of ["ffmpeg", "ffprobe", "say"]) {
  if (run("which", [bin], { allowFail: true }).status !== 0) throw new Error(`${bin} が見つかりません`);
}
if (!existsSync(CHROME)) throw new Error(`Chrome が見つかりません: ${CHROME}（環境変数 CHROME で指定できます）`);

rmSync(join(OUT, "work"), { recursive: true, force: true });
for (const d of ["", "audio", "work"]) mkdirSync(join(OUT, d), { recursive: true });

// ---------------------------------------------------------------- 1. ナレーション（say。同じ文章なら作り直さない）

function synth(n, text) {
  const key = createHash("sha1").update(`${config.voice}|${config.rate}|${text}`).digest("hex").slice(0, 10);
  const wav = join(OUT, "audio", `scene${n}-${key}.wav`);
  if (!existsSync(wav)) {
    const aiff = wav.replace(/\.wav$/, ".aiff");
    run("say", ["-v", config.voice, "-r", String(config.rate), "-o", aiff, text]);
    ff("-i", aiff, "-ar", "48000", "-ac", "1", wav);
    rmSync(aiff, { force: true });
  }
  return wav;
}

// ---------------------------------------------------------------- 2. 画面（1920x1080 の PNG）

// ブラウザデモを 127.0.0.1 で配る（web/dist は npm run web:build で作る）
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = join(ROOT, "web", path === "/" ? "index.html" : path);
  if (!file.startsWith(join(ROOT, "web")) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  res.writeHead(200, { "content-type": `${types[extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;

// 注意: ここは非同期で起動する。spawnSync だと上の HTTP サーバーが応答できず、Chrome が待ち続けて止まる
const execFileP = promisify(execFile);
async function shoot(url, png) {
  const profile = join(OUT, "work", "chrome-profile");
  await execFileP(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, `--window-size=${VW},${VH}`, `--force-device-scale-factor=${DPR}`,
    "--virtual-time-budget=4000", `--screenshot=${png}`, url,
  ], { timeout: 60000 });
  if (!existsSync(png)) throw new Error(`スクリーンショットができませんでした: ${url}`);
}

function page(name, html) {
  const file = join(OUT, "work", `${name}.html`);
  writeFileSync(file, html);
  return `file://${file}`;
}

const BASE_CSS = `html,body{margin:0;width:${VW}px;height:${VH}px;background:#031007;color:#5dff7a;font-family:ui-monospace,"SF Mono",Menlo,monospace;overflow:hidden}`;

function cardHtml(lines, style, tag) {
  const size = style === "code" ? 84 : style === "big" ? 50 : 36;
  const body = lines.map((l) => `<div>${esc(l)}</div>`).join("");
  return `<!doctype html><meta charset=utf-8><style>${BASE_CSS}
    body{display:flex;align-items:center;justify-content:center;flex-direction:column}
    div{font-size:${size}px;white-space:pre;text-shadow:0 0 18px #2fa84a;line-height:1.4}
    small{position:absolute;bottom:28px;color:#2fa84a;font-size:18px}</style>${body}${tag ? `<small>${esc(tag)}</small>` : ""}`;
}

function termHtml(blocks) {
  const body = blocks.map((b) => `<div class=p>$ ${esc(b.cmd)}</div><pre>${esc(b.out)}</pre>`).join("");
  return `<!doctype html><meta charset=utf-8><style>${BASE_CSS}
    body{padding:40px 56px;box-sizing:border-box;background:#000;color:#d7ffe0}
    .p{color:#5dff7a;font-size:32px;margin:0 0 14px}
    pre{font-size:30px;line-height:1.35;margin:0 0 26px;white-space:pre-wrap;word-break:break-all}</style>${body}`;
}

const facts = { tests: undefined };

async function termShot(shot, name) {
  const blocks = shot.cmds.map((c) => {
    const r = run("sh", ["-c", c.cmd], { cwd: ROOT, allowFail: true, env: { ...process.env, COBF_LANG: "en", NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" } });
    // 画面にユーザー名やローカルのパスを出さない（公開する動画なので）
    const all = stripAnsi(`${r.stdout}${r.stderr}`).replaceAll(ROOT, "~/kiroween2026").replaceAll(homedir(), "~").replace(/\s+$/, "");
    if (/\/Users\/|\/home\//.test(all)) warnings.push(`端末の出力にローカルのパスが残っています: ${c.cmd}`);
    if (r.status !== 0) warnings.push(`コマンドが失敗しました (exit ${r.status}): ${c.cmd}`);
    if (c.id === "tests") facts.tests = all.match(/Tests\s+(\d+)\s+passed/)?.[1];
    let lines = all.split("\n");
    if (c.head) lines = lines.slice(0, c.head);
    if (c.tail) lines = lines.slice(-c.tail);
    return { cmd: c.cmd, out: lines.join("\n") };
  });
  const png = join(OUT, "work", `${name}.png`);
  await shoot(page(name, termHtml(blocks)), png);
  return { png };
}

async function makeShot(shot, name) {
  const png = join(OUT, "work", `${name}.png`);
  if (shot.type === "web") {
    const q = new URLSearchParams({ lang: "en", sample: shot.sample, scroll: String(shot.scroll ?? 0) });
    await shoot(`http://127.0.0.1:${port}/?${q}`, png);
    return { png };
  }
  if (shot.type === "card") {
    await shoot(page(name, cardHtml(shot.lines, shot.style)), png);
    return { png };
  }
  if (shot.type === "term") return termShot(shot, name);
  if (shot.type === "clip") {
    const file = join(ROOT, shot.file);
    if (existsSync(file)) return { clip: file };
    warnings.push(`実デプロイの映像がありません: ${shot.file}（目印のカードで代用）`);
    await shoot(page(name, cardHtml(["[ RECORD THIS CLIP ]", shot.label], "plain", shot.file)), png);
    return { png };
  }
  throw new Error(`未知の shot type: ${shot.type}`);
}

// ---------------------------------------------------------------- 3. 場面ごとに映像を作る

const FILTER = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${FPS},format=yuv420p,setsar=1`;
const sceneVideos = [];
const sceneWavs = [];
const timeline = []; // 字幕用: { start, end, text }
let clock = 0;

for (const scene of config.scenes) {
  const text = narration.get(scene.n);
  const wav = synth(scene.n, text);
  const len = duration(wav) + config.padSeconds;
  const per = len / scene.shots.length;

  const parts = [];
  for (const [i, shot] of scene.shots.entries()) {
    const name = `s${scene.n}-${i + 1}`;
    const made = await makeShot(shot, name);
    const out = join(OUT, "work", `${name}.mp4`);
    if (made.png) {
      ff("-loop", "1", "-framerate", String(FPS), "-t", per.toFixed(3), "-i", made.png, "-vf", FILTER, "-an", "-c:v", "libx264", "-crf", "18", out);
    } else {
      // 事前に撮った映像: 場面の割り当て時間に収まるよう速度を合わせる（長ければ早送り、短ければ最後で止める）
      const src = duration(made.clip);
      const speed = Math.max(src / per, 1);
      ff("-i", made.clip, "-vf", `setpts=PTS/${speed.toFixed(4)},${FILTER},tpad=stop_mode=clone:stop_duration=${per.toFixed(3)}`, "-t", per.toFixed(3), "-an", "-c:v", "libx264", "-crf", "18", out);
      if (speed > 1.05) warnings.push(`${shot.file} を ${speed.toFixed(1)} 倍速にしました。画面に "sped up" と入れてください（実時間でないことを隠さない）`);
    }
    parts.push(out);
  }

  const list = join(OUT, "work", `scene${scene.n}.txt`);
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const sceneVideo = join(OUT, "work", `scene${scene.n}.mp4`);
  ff("-f", "concat", "-safe", "0", "-i", list, "-c", "copy", sceneVideo);
  sceneVideos.push(sceneVideo);

  // ナレーションに無音の余白をつけて、映像と同じ長さにする
  const padded = join(OUT, "work", `scene${scene.n}.wav`);
  ff("-i", wav, "-af", `apad=pad_dur=${config.padSeconds}`, "-t", len.toFixed(3), "-ar", "48000", "-ac", "1", padded);
  sceneWavs.push(padded);

  // 字幕: 文ごとに、文字数に比例して時間を割り当てる
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  const total = sentences.reduce((a, s) => a + s.length, 0);
  let t = clock;
  for (const s of sentences) {
    const d = ((len - config.padSeconds) * s.length) / total;
    timeline.push({ start: t, end: t + d, text: s });
    t += d;
  }
  clock += len;
}
server.close();

// ---------------------------------------------------------------- 4. つなぐ（映像 + 音声 + 字幕）

const fmt = (sec) => {
  const ms = Math.round(sec * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = join(OUT, "demo.srt");
writeFileSync(srt, timeline.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join("\n"));

const vlist = join(OUT, "work", "videos.txt");
const alist = join(OUT, "work", "audios.txt");
writeFileSync(vlist, sceneVideos.map((p) => `file '${p}'`).join("\n"));
writeFileSync(alist, sceneWavs.map((p) => `file '${p}'`).join("\n"));
const video = join(OUT, "work", "video.mp4");
const audio = join(OUT, "work", "audio.wav");
ff("-f", "concat", "-safe", "0", "-i", vlist, "-c", "copy", video);
ff("-f", "concat", "-safe", "0", "-i", alist, "-c", "copy", audio);

const final = join(OUT, "demo.mp4");
ff("-i", video, "-i", audio, "-i", srt, "-map", "0:v", "-map", "1:a", "-map", "2:s", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-shortest", "-movflags", "+faststart", final);

// ---------------------------------------------------------------- 5. 確認

const total = duration(final);
console.log(`\n出力: ${final}\n字幕: ${srt}\n長さ: ${total.toFixed(1)} 秒`);
if (total >= config.maxSeconds) warnings.push(`長さが ${total.toFixed(1)} 秒です。Devpost の要件は 3 分未満。ナレーションの速度 (video/scenes.json の rate) か台本を見直してください`);
// ナレーションが「More than three hundred tests」と言うなら、実測が 300 件を超えていること
const claimed = [...narration.values()].join(" ").match(/More than three hundred tests/i);
if (claimed && facts.tests && Number(facts.tests) <= 300) warnings.push(`台本は「300 テスト超」と言っていますが、実際は ${facts.tests} 件です。台本を直してください`);
if (facts.tests) console.log(`テスト: ${facts.tests} 件（画面に映した実測値）`);
if (warnings.length) {
  console.log("\n要確認:");
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log("\n撮影前の注意: 画面にアカウント ID・ARN・プロファイル名が映っていないことを、目で確認してから公開する。");
