import { setLocale, type Locale } from "../../src/i18n.js";
import { buildListing, type Listing } from "./listing.js";
import { SAMPLES } from "./samples.js";
import { pickLocale, UI, type UiKey } from "./ui.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がありません`);
  return el as T;
};

const source = $<HTMLTextAreaElement>("source");
const paper = $<HTMLDivElement>("paper");
const status = $<HTMLParagraphElement>("status");
const select = $<HTMLSelectElement>("sample");
const muteButton = $<HTMLButtonElement>("mute");
const langButton = $<HTMLButtonElement>("lang");
const ruler = document.querySelector<HTMLPreElement>(".ruler");

// ---------------------------------------------------------------- 言語（既定は英語。?lang=ja か右上のボタンで日本語）

let locale: Locale = pickLocale(window.location.search);
setLocale(locale);

const t = (key: UiKey): string => UI[locale][key];

function applyTexts(): void {
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset["i18n"] as UiKey);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) el.title = t(el.dataset["i18nTitle"] as UiKey);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset["i18nLabel"] as UiKey));
  muteButton.textContent = muted ? t("soundOff") : t("soundOn");
  langButton.textContent = t("switchTo");
  langButton.lang = locale === "en" ? "ja" : "en";
  for (const opt of select.options) {
    const sample = SAMPLES.find((x) => x.id === opt.value);
    if (sample) opt.textContent = sample.label[locale];
  }
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- ルーラー（1〜80 桁）

if (ruler) {
  const tens = Array.from({ length: 80 }, (_, i) => ((i + 1) % 10 === 0 ? String(((i + 1) / 10) % 10) : " ")).join("");
  const units = Array.from({ length: 80 }, (_, i) => String((i + 1) % 10)).join("");
  ruler.textContent = `${tens}\n${units}`;
}

// ---------------------------------------------------------------- 音（既定は OFF）

let muted = true;
let audio: AudioContext | undefined;

function tick(): void {
  if (muted) return;
  audio ??= new AudioContext();
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "square";
  osc.frequency.value = 1400 + Math.random() * 500;
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.02);
}

muteButton.addEventListener("click", () => {
  muted = !muted;
  muteButton.setAttribute("aria-pressed", String(muted));
  muteButton.textContent = muted ? t("soundOff") : t("soundOn");
  if (!muted) tick();
});

// ---------------------------------------------------------------- 印字

let printing = 0; // 世代番号。新しい印字が始まったら古いものを止める

function render(listing: Listing): void {
  const generation = ++printing;
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  paper.replaceChildren(sheet);

  const add = (i: number): void => {
    const l = listing.lines[i];
    if (!l) return;
    const row = document.createElement("span");
    row.className = `line ${l.cls}`;
    row.textContent = l.text === "" ? " " : l.text;
    sheet.append(row);
    paper.scrollTop = paper.scrollHeight;
    tick();
  };

  // 動きを減らす設定、または行が多いときは一気に印字する
  if (reducedMotion || listing.lines.length > 400) {
    for (let i = 0; i < listing.lines.length; i++) add(i);
    return;
  }

  let i = 0;
  const step = (): void => {
    if (generation !== printing || i >= listing.lines.length) return;
    add(i++);
    window.setTimeout(step, 18);
  };
  step();
}

// ---------------------------------------------------------------- コンパイル

let debounce: number | undefined;

function compileNow(): void {
  const text = source.value;
  const listing = buildListing(text, "PROGRAM.CBL");
  status.textContent = listing.ok ? t("statusOk") : t("statusFail");
  render(listing);
}

source.addEventListener("input", () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(compileNow, 350);
});

// ---------------------------------------------------------------- サンプル

for (const s of SAMPLES) {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.label[locale];
  select.append(opt);
}

function loadSample(id: string): void {
  const sample = SAMPLES.find((s) => s.id === id) ?? SAMPLES[0];
  if (!sample) return;
  source.value = sample.source;
  compileNow();
}

select.addEventListener("change", () => loadSample(select.value));
loadSample(SAMPLES[0]?.id ?? "s3");

langButton.addEventListener("click", () => {
  locale = locale === "en" ? "ja" : "en";
  setLocale(locale);
  applyTexts();
  compileNow(); // メッセージの言語が変わるので、帳票を作り直す
});

applyTexts();
compileNow();
