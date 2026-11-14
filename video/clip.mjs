#!/usr/bin/env node
// 画面録画（Terminal のウィンドウ 1 枚を `screencapture -l` で撮ったもの）を、動画に載せる形に整える。
//   - タイトルバーを切り落とす（ユーザー名やホスト名が出るため）
//   - 区間ごとに速度を変える。待ち時間だけ早送りし、早送りの区間には「SPED UP ×N」を重ねる
//   - 30fps の mp4 にして video/clips/ に置く
//
// 使い方:
//   node video/clip.mjs <raw.mov> <out.mp4> '<segments>'
// segments は「開始秒-終了秒@倍速」をカンマでつないだもの。倍速が 1 なら等倍、1 より大きければ早送りで、バッジが付く。
//   例: node video/clip.mjs raw.mov video/clips/deploy-messaging.mp4 '2.2-11@1,11-82@12,82-96@1'
// 追加の依存なし: ffmpeg と Google Chrome（バッジの画像を描くため）。AWS には触らない。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// 録画の上端のうち、タイトルバーの高さ（ピクセル）。ウィンドウの縦横比は 2.06 倍（Retina）で、タイトルバーは約 48pt。
// 試し撮りの 1 コマで、これで文字が欠けずにタイトルバーが消えることを確かめてある。
const TITLE_BAR_PX = 104;

const [raw, out, spec] = process.argv.slice(2);
if (!raw || !out || !spec) {
  console.error("使い方: node video/clip.mjs <raw.mov> <out.mp4> '2.2-11@1,11-82@12,82-96@1'");
  process.exit(2);
}
if (!existsSync(raw)) {
  console.error(`録画が見つかりません: ${raw}`);
  process.exit(2);
}

const segments = spec.split(",").map((s) => {
  const m = /^([\d.]+)-([\d.]+)@([\d.]+)$/.exec(s.trim());
  if (!m) throw new Error(`区間の書き方が違います: "${s}"（例: 11-82@12）`);
  const [start, end, speed] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(end > start) || !(speed >= 1)) throw new Error(`区間が不正です: "${s}"（終了 > 開始、倍速 >= 1）`);
  return { start, end, speed };
});

const ff = (...args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probe = (file, entries) => execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "csv=p=0", file], { encoding: "utf8" }).trim();

const duration = Number(probe(raw, "format=duration"));
for (const s of segments) if (s.end > duration + 0.05) throw new Error(`区間 ${s.start}-${s.end} が録画の長さ ${duration.toFixed(1)} 秒を超えています`);
const width = Number(probe(raw, "stream=width").split("\n")[0]);

// ---------------------------------------------------------------- バッジ（早送りの区間に重ねる画像）
const work = join(ROOT, "video", "out", "work-clip");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const badges = new Map();
for (const s of segments.filter((x) => x.speed > 1)) {
  const label = `SPED UP  x${Math.round(s.speed)}`;
  if (badges.has(label)) continue;
  const html = join(work, `badge-${badges.size}.html`);
  const png = join(work, `badge-${badges.size}.png`);
  writeFileSync(
    html,
    `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#031007}
    div{box-sizing:border-box;width:100vw;height:100vh;border:6px solid #5dff7a;color:#5dff7a;font:700 64px/1 ui-monospace,Menlo,monospace;
    display:flex;align-items:center;justify-content:center;letter-spacing:4px}</style><div>&gt;&gt; ${label}</div>`,
  );
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--window-size=900,150`, "--force-device-scale-factor=1", `--screenshot=${png}`, `file://${html}`], { stdio: "ignore", timeout: 60000 });
  if (!existsSync(png)) throw new Error("バッジの画像ができませんでした");
  badges.set(label, png);
}

// ---------------------------------------------------------------- 区間ごとに切り出して、つなぐ
const inputs = ["-i", raw];
const parts = [];
const filters = [`[0:v]crop=iw:ih-${TITLE_BAR_PX}:0:${TITLE_BAR_PX},fps=30,format=yuv420p,split=${segments.length}${segments.map((_, i) => `[s${i}]`).join("")}`];
let badgeInput = 1;
segments.forEach((s, i) => {
  let chain = `[s${i}]trim=${s.start}:${s.end},setpts=(PTS-STARTPTS)/${s.speed}`;
  if (s.speed > 1) {
    const label = `SPED UP  x${Math.round(s.speed)}`;
    inputs.push("-i", badges.get(label));
    // バッジは右下に置く。帳票の見出しは 132 桁で右端まで届くので、右上に置くと文字を隠してしまう。
    // 早送りの区間で画面の下半分が空いているのは、デプロイの途中（イベントが上から並ぶ間）だけ
    const scale = Math.round(width * 0.2);
    filters.push(`${chain}[t${i}]`);
    filters.push(`[${badgeInput}:v]scale=${scale}:-1[b${i}]`);
    filters.push(`[t${i}][b${i}]overlay=W-w-${Math.round(width * 0.03)}:H-h-${Math.round(width * 0.05)}[p${i}]`);
    badgeInput++;
  } else {
    filters.push(`${chain}[p${i}]`);
  }
  parts.push(`[p${i}]`);
});
filters.push(`${parts.join("")}concat=n=${segments.length}:v=1:a=0,fps=30,format=yuv420p[out]`);

mkdirSync(dirname(resolve(out)), { recursive: true });
ff(...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", out);

const total = Number(probe(out, "format=duration"));
const real = segments.reduce((a, s) => a + (s.end - s.start), 0);
console.log(`書き出し: ${out}`);
console.log(`実時間 ${real.toFixed(1)} 秒 → ${total.toFixed(1)} 秒（${segments.map((s) => `${s.start}-${s.end}${s.speed > 1 ? ` x${s.speed}` : ""}`).join(" / ")}）`);
rmSync(work, { recursive: true, force: true });
