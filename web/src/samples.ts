import cache from "../../tests/golden/cache/input.cbl";
import classic from "../../tests/golden/classic/input.cbl";
import containers from "../../tests/golden/containers/input.cbl";
import db from "../../tests/golden/db-mrsc/input.cbl";
import edge from "../../tests/golden/edge/input.cbl";
import eks from "../../tests/golden/eks/input.cbl";
import lambda from "../../tests/golden/lambda/input.cbl";
import messaging from "../../tests/golden/messaging/input.cbl";
import policy from "../../tests/golden/policy-ref/input.cbl";
import s3 from "../../tests/golden/s3/input.cbl";
import threeTier from "../../tests/golden/three-tier/input.cbl";

export interface Sample {
  id: string;
  label: { en: string; ja: string };
  source: string;
}

/** 6 桁の連番 + 空白 + コード、で 1 行を組み立てる。 */
function cards(...rows: string[]): string {
  return rows.map((r, i) => `${String((i + 1) * 100).padStart(6, "0")} ${r}`).join("\n");
}

const head = ["IDENTIFICATION DIVISION.", "PROGRAM-ID. HAUNTED.", "ENVIRONMENT DIVISION.", "CONFIGURATION SECTION.", "OBJECT-COMPUTER. AWS-AP-NORTHEAST-1."];

export const SAMPLES: Sample[] = [
  { id: "s3", label: { en: "S3 bucket", ja: "S3 バケット" }, source: s3 },
  { id: "lambda", label: { en: "Lambda + IAM role", ja: "Lambda + IAM ロール" }, source: lambda },
  { id: "policy", label: { en: "IAM policy (OCCURS + MOVE)", ja: "IAM ポリシー（OCCURS + MOVE）" }, source: policy },
  { id: "db", label: { en: "DynamoDB MRSC (Tokyo and Osaka + Seoul witness)", ja: "DynamoDB MRSC（東京・大阪 + ソウル）" }, source: db },
  { id: "three-tier", label: { en: "The classic three-tier (VPC + ALB + EC2 + RDS)", ja: "王道の 3 層構成（VPC + ALB + EC2 + RDS）" }, source: threeTier },
  { id: "edge", label: { en: "CloudFront + ACM + Route 53 (us-east-1)", ja: "CloudFront + ACM + Route 53（us-east-1）" }, source: edge },
  { id: "classic", label: { en: "The ancient way (CLB + EC2)", ja: "いにしえの構成（CLB + EC2）" }, source: classic },
  { id: "containers", label: { en: "ECS Fargate (logs + task + service)", ja: "ECS Fargate（ログ + タスク + サービス）" }, source: containers },
  { id: "eks", label: { en: "EKS (cluster + node group)", ja: "EKS（クラスター + ノードグループ）" }, source: eks },
  { id: "cache", label: { en: "ElastiCache (Redis replication)", ja: "ElastiCache（Redis のレプリケーション）" }, source: cache },
  { id: "messaging", label: { en: "SNS to SQS (with a dead-letter queue)", ja: "SNS → SQS（DLQ つき）" }, source: messaging },
  {
    id: "shift",
    label: { en: "Shifted column (column 7 is off)", ja: "桁ずれ（7 桁目がずれている）" },
    source: ["000100IDENTIFICATION DIVISION.", "000200 PROGRAM-ID. HAUNTED."].join("\n"),
  },
  { id: "heresy", label: { en: "Lower case (heresy)", ja: "小文字（異端）" }, source: cards("identification division.", "PROGRAM-ID. HAUNTED.") },
  {
    id: "dblink",
    label: { en: "DBLINK (the ghost of 8i)", ja: "DBLINK（8i の亡霊）" },
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
