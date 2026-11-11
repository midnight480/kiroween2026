import type { Json } from "./emit.js";

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function scalar(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

function isScalar(v: Json): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}

/** CloudFormation テンプレート用の最小 YAML 出力（文字列は常に二重引用符）。 */
export function toYaml(value: Json, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (isScalar(value)) return `${scalar(value)}\n`;

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]\n";
    return value
      .map((v) => {
        if (isScalar(v)) return `${pad}- ${scalar(v)}\n`;
        const inner = toYaml(v, indent + 1);
        // 先頭行を "- " に載せる
        const lines = inner.split("\n");
        const first = (lines[0] ?? "").trimStart();
        return `${pad}- ${first}\n${lines.slice(1).join("\n")}`;
      })
      .join("");
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return "{}\n";
  return entries
    .map(([k, v]) => {
      const key = PLAIN_KEY.test(k) ? k : JSON.stringify(k);
      if (isScalar(v)) return `${pad}${key}: ${scalar(v)}\n`;
      if (Array.isArray(v) && v.length === 0) return `${pad}${key}: []\n`;
      if (!Array.isArray(v) && Object.keys(v).length === 0) return `${pad}${key}: {}\n`;
      return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
    })
    .join("");
}
