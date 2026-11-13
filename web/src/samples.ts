import db from "../../tests/golden/db-mrsc/input.cbl";
import lambda from "../../tests/golden/lambda/input.cbl";
import policy from "../../tests/golden/policy-ref/input.cbl";
import s3 from "../../tests/golden/s3/input.cbl";

export interface Sample {
  id: string;
  label: string;
  source: string;
}

/** 6 桁の連番 + 空白 + コード、で 1 行を組み立てる。 */
function cards(...rows: string[]): string {
  return rows.map((r, i) => `${String((i + 1) * 100).padStart(6, "0")} ${r}`).join("\n");
}

const head = ["IDENTIFICATION DIVISION.", "PROGRAM-ID. HAUNTED.", "ENVIRONMENT DIVISION.", "CONFIGURATION SECTION.", "OBJECT-COMPUTER. AWS-AP-NORTHEAST-1."];

export const SAMPLES: Sample[] = [
  { id: "s3", label: "S3 バケット", source: s3 },
  { id: "lambda", label: "Lambda + IAM ロール", source: lambda },
  { id: "policy", label: "IAM ポリシー（OCCURS + MOVE）", source: policy },
  { id: "db", label: "DynamoDB MRSC（東京・大阪 + ソウル）", source: db },
  {
    id: "shift",
    label: "桁ずれ（7 桁目がずれている）",
    source: ["000100IDENTIFICATION DIVISION.", "000200 PROGRAM-ID. HAUNTED."].join("\n"),
  },
  { id: "heresy", label: "小文字（異端）", source: cards("identification division.", "PROGRAM-ID. HAUNTED.") },
  {
    id: "dblink",
    label: "DBLINK（8i の亡霊）",
    source: cards(
      ...head,
      "INPUT-OUTPUT SECTION.",
      "FILE-CONTROL.",
      '    SELECT ORDERS-FILE ASSIGN TO "DBLINK".',
      "DATA DIVISION.",
      "PROCEDURE DIVISION.",
      "MAIN-PARA.",
      "    STOP RUN.",
    ),
  },
];
