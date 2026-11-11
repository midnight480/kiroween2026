import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { CobolError } from "../src/errors.js";

/** 6 桁の連番 + 空白 + コード、で 1 行を組み立てる */
function cards(...rows: string[]): string {
  return rows.map((r, i) => `${String((i + 1) * 100).padStart(6, "0")} ${r}`).join("\n");
}

const HEAD = [
  "IDENTIFICATION DIVISION.",
  "PROGRAM-ID. T.",
  "ENVIRONMENT DIVISION.",
  "CONFIGURATION SECTION.",
  "OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.",
  "DATA DIVISION.",
  "WORKING-STORAGE SECTION.",
];

function errorOf(src: string): CobolError {
  try {
    compile(src);
  } catch (e) {
    if (e instanceof CobolError) return e;
    throw e;
  }
  throw new Error("エラーになるはずが成功した");
}

describe("固定形式カードリーダ", () => {
  it("タブを拒否する", () => {
    const e = errorOf("000100 IDENTIFICATION\tDIVISION.");
    expect(e.code).toBe("TAB-FORBIDDEN");
    expect(e.line).toBe(1);
  });

  it("80 桁超を拒否する", () => {
    const e = errorOf(`000100 ${"X".repeat(80)}`);
    expect(e.code).toBe("LINE-TOO-LONG");
  });

  it("7 桁目がずれたら桁ずれエラー（行・桁つき）", () => {
    const e = errorOf("000100IDENTIFICATION DIVISION.");
    expect(e.code).toBe("INVALID-INDICATOR");
    expect(e.line).toBe(1);
    expect(e.col).toBe(7);
  });

  it("小文字の予約語を拒否する", () => {
    const e = errorOf(cards("identification division."));
    expect(e.code).toBe("LOWERCASE-NOT-ALLOWED");
  });

  it("リテラルの継続行を結合する", () => {
    const long = "A".repeat(70);
    const src = cards(
      ...HEAD,
      "01  B.",
      '    05  RESOURCE-TYPE PIC X(20) VALUE "AWS::S3::Bucket".',
      "    05  BUCKET-NAME   PIC X(99) VALUE",
      `        "${long.slice(0, 50)}`,
    ).split("\n");
    // 継続行（7 桁目 '-'）を手で作る
    src.push(`000900-    "${long.slice(50)}".`);
    src.push("001000 PROCEDURE DIVISION.");
    src.push("001100 MAIN-PARA.");
    src.push('001200     CALL "DEPLOY".');
    const result = compile(src.join("\n"));
    const props = (result.template["Resources"] as any).B.Properties;
    // 前行は 72 桁まで空白で埋めて連結される（COBOL の規則）
    expect(props.BucketName.startsWith("A".repeat(50))).toBe(true);
    expect(props.BucketName.endsWith("A".repeat(20))).toBe(true);
  });
});

describe("意味解析", () => {
  const bucket = [
    "01  B.",
    '    05  RESOURCE-TYPE PIC X(20) VALUE "AWS::S3::Bucket".',
    '    05  BUCKET-NAME   PIC X(5) VALUE "TOOLONGNAME".',
  ];

  it("VALUE が PIC を超えたらエラー", () => {
    const e = errorOf(cards(...HEAD, ...bucket, "PROCEDURE DIVISION."));
    expect(e.code).toBe("PIC-OVERFLOW");
  });

  it("未定義参照はエラー", () => {
    const src = cards(
      ...HEAD,
      "01  P.",
      '    05  RESOURCE-TYPE PIC X(25) VALUE "AWS::IAM::ManagedPolicy".',
      "    05  STMT OCCURS 1 TIMES.",
      "        10  STMT-EFFECT PIC X(5).",
      "        10  STMT-ACTION PIC X(30).",
      "        10  STMT-RES PIC X(60).",
      "PROCEDURE DIVISION.",
      "MAIN-PARA.",
      '    MOVE "Allow" TO STMT-EFFECT (1).',
      '    MOVE "s3:GetObject" TO STMT-ACTION (1).',
      '    MOVE "REF:NOWHERE" TO STMT-RES (1).',
    );
    expect(errorOf(src).code).toBe("UNDEFINED-REFERENCE");
  });

  it("添字が範囲外ならエラー", () => {
    const src = cards(
      ...HEAD,
      "01  P.",
      '    05  RESOURCE-TYPE PIC X(25) VALUE "AWS::IAM::ManagedPolicy".',
      "    05  STMT OCCURS 2 TIMES.",
      "        10  STMT-EFFECT PIC X(5).",
      "PROCEDURE DIVISION.",
      "MAIN-PARA.",
      '    MOVE "Allow" TO STMT-EFFECT (3).',
    );
    expect(errorOf(src).code).toBe("SUBSCRIPT-OUT-OF-RANGE");
  });

  it("未対応の文は黙って無視せず明示エラー", () => {
    const src = cards(...HEAD, ...bucket.slice(0, 2), "PROCEDURE DIVISION.", "MAIN-PARA.", "    PERFORM MAIN-PARA.");
    expect(errorOf(src).code).toBe("UNSUPPORTED-IN-MVP");
  });

  it("複数 MOVE は最後が勝つ", () => {
    const src = cards(
      ...HEAD,
      "01  B.",
      '    05  RESOURCE-TYPE PIC X(20) VALUE "AWS::S3::Bucket".',
      "    05  BUCKET-NAME   PIC X(20).",
      "PROCEDURE DIVISION.",
      "MAIN-PARA.",
      '    MOVE "first" TO BUCKET-NAME.',
      '    MOVE "second" TO BUCKET-NAME.',
    );
    const props = (compile(src).template["Resources"] as any).B.Properties;
    expect(props.BucketName).toBe("second");
  });

  it("循環参照を検出する", () => {
    const src = cards(
      ...HEAD,
      "01  A.",
      '    05  RESOURCE-TYPE PIC X(25) VALUE "AWS::Lambda::Function".',
      '    05  FN-RUNTIME PIC X(12) VALUE "nodejs22.x".',
      '    05  FN-HANDLER PIC X(20) VALUE "index.handler".',
      '    05  FN-ROLE-ARN PIC X(30) VALUE "GETATT:B.ARN".',
      "01  B.",
      '    05  RESOURCE-TYPE PIC X(25) VALUE "AWS::Lambda::Function".',
      '    05  FN-RUNTIME PIC X(12) VALUE "nodejs22.x".',
      '    05  FN-HANDLER PIC X(20) VALUE "index.handler".',
      '    05  FN-ROLE-ARN PIC X(30) VALUE "GETATT:A.ARN".',
      "PROCEDURE DIVISION.",
    );
    expect(errorOf(src).code).toBe("CIRCULAR-REFERENCE");
  });

  it("DBLINK は意図的にエラー", () => {
    const src = cards(
      "IDENTIFICATION DIVISION.",
      "PROGRAM-ID. T.",
      "ENVIRONMENT DIVISION.",
      "INPUT-OUTPUT SECTION.",
      "FILE-CONTROL.",
      '    SELECT X-FILE ASSIGN TO "DBLINK".',
      "DATA DIVISION.",
      "PROCEDURE DIVISION.",
    );
    expect(errorOf(src).code).toBe("DBLINK-RETIRED");
  });
});

describe("エスケープ", () => {
  it("REF の接尾辞に書いた ${ は Fn::Sub の置換にならないようエスケープする", () => {
    const src = cards(
      ...HEAD,
      "01  B.",
      '    05  RESOURCE-TYPE PIC X(20) VALUE "AWS::S3::Bucket".',
      "01  P.",
      '    05  RESOURCE-TYPE PIC X(25) VALUE "AWS::IAM::ManagedPolicy".',
      "    05  STMT OCCURS 1 TIMES.",
      "        10  STMT-EFFECT PIC X(5).",
      "        10  STMT-ACTION PIC X(30).",
      "        10  STMT-RES PIC X(60).",
      "PROCEDURE DIVISION.",
      "MAIN-PARA.",
      '    MOVE "Allow" TO STMT-EFFECT (1).',
      '    MOVE "s3:GetObject" TO STMT-ACTION (1).',
      '    MOVE "REF:B/${AWS::AccountId}/x" TO STMT-RES (1).',
    );
    const stmt = (compile(src).template["Resources"] as any).P.Properties.PolicyDocument.Statement[0];
    // 参照部分の ${B.Arn} だけが置換、利用者の ${...} は ${!...} でリテラルになる
    expect(stmt.Resource).toEqual({ "Fn::Sub": "${B.Arn}/${!AWS::AccountId}/x" });
  });
});

describe("S3 の既定と警告", () => {
  it("BLOCK-PUBLIC を省略すると全ブロック（Security by default）", () => {
    const src = cards(
      ...HEAD,
      "01  B.",
      '    05  RESOURCE-TYPE PIC X(20) VALUE "AWS::S3::Bucket".',
      "PROCEDURE DIVISION.",
    );
    const props = (compile(src).template["Resources"] as any).B.Properties;
    expect(props.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    });
    expect(props.VersioningConfiguration.Status).toBe("Suspended");
  });

  it('BLOCK-PUBLIC "N" は全て false と警告', () => {
    const src = cards(
      ...HEAD,
      "01  B.",
      '    05  RESOURCE-TYPE PIC X(20) VALUE "AWS::S3::Bucket".',
      '    05  BLOCK-PUBLIC PIC X VALUE "N".',
      "PROCEDURE DIVISION.",
    );
    const r = compile(src);
    expect((r.template["Resources"] as any).B.Properties.PublicAccessBlockConfiguration.BlockPublicAcls).toBe(false);
    expect(r.warnings.some((w) => w.code === "PUBLIC-ACCESS-ALLOWED")).toBe(true);
  });
});

describe("リージョン決定ルール（§4.5）", () => {
  it("OBJECT-COMPUTER を主リージョンとして返す", () => {
    const r = compile(cards(...HEAD, "PROCEDURE DIVISION."));
    expect(r.region).toBe("ap-northeast-1");
  });

  it("MRSC で OBJECT-COMPUTER が無ければ REPLICA-1 にフォールバックする", () => {
    const src = cards(
      "IDENTIFICATION DIVISION.",
      "PROGRAM-ID. T.",
      "ENVIRONMENT DIVISION.",
      "INPUT-OUTPUT SECTION.",
      "FILE-CONTROL.",
      '    SELECT O-FILE ASSIGN TO "DYNAMODB-MRSC"',
      "        ORGANIZATION IS INDEXED",
      "        RECORD KEY IS O-ID.",
      "DATA DIVISION.",
      "FILE SECTION.",
      "FD  O-FILE.",
      "01  O-REC.",
      "    05  O-ID PIC X(36).",
      "WORKING-STORAGE SECTION.",
      "01  O-FILE-REGIONS.",
      '    05  REPLICA-1 PIC X(20) VALUE "ap-northeast-1".',
      '    05  REPLICA-2 PIC X(20) VALUE "ap-northeast-3".',
      '    05  WITNESS-REGION PIC X(20) VALUE "ap-northeast-2".',
      "PROCEDURE DIVISION.",
    );
    expect(compile(src).region).toBe("ap-northeast-1");
  });

  it("主リージョンがレプリカに含まれなければエラー", () => {
    const src = cards(
      "IDENTIFICATION DIVISION.",
      "PROGRAM-ID. T.",
      "ENVIRONMENT DIVISION.",
      "CONFIGURATION SECTION.",
      "OBJECT-COMPUTER. AWS-US-EAST-1.",
      "INPUT-OUTPUT SECTION.",
      "FILE-CONTROL.",
      '    SELECT O-FILE ASSIGN TO "DYNAMODB-MRSC"',
      "        ORGANIZATION IS INDEXED",
      "        RECORD KEY IS O-ID.",
      "DATA DIVISION.",
      "FILE SECTION.",
      "FD  O-FILE.",
      "01  O-REC.",
      "    05  O-ID PIC X(36).",
      "WORKING-STORAGE SECTION.",
      "01  O-FILE-REGIONS.",
      '    05  REPLICA-1 PIC X(20) VALUE "ap-northeast-1".',
      '    05  REPLICA-2 PIC X(20) VALUE "ap-northeast-3".',
      '    05  WITNESS-REGION PIC X(20) VALUE "ap-northeast-2".',
      "PROCEDURE DIVISION.",
    );
    expect(errorOf(src).code).toBe("STACK-REGION-NOT-A-REPLICA");
  });
});
