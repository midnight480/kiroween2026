import { describe, expect, it } from "vitest";
import { compile } from "../src/compile.js";
import { CobolError } from "../src/errors.js";

/** 6 桁の連番 + 空白 + コード。 */
function cards(...rows: string[]): string {
  // 1 つの行に "\n" があれば、複数のカードに分ける（長い VALUE を次の行に回すため）
  return rows.flatMap((r) => r.split("\n")).map((r, i) => `${String((i + 1) * 100).padStart(6, "0")} ${r}`).join("\n");
}

const head = (region = "AP-NORTHEAST-1"): string[] => [
  "IDENTIFICATION DIVISION.",
  "PROGRAM-ID. T.",
  "ENVIRONMENT DIVISION.",
  "CONFIGURATION SECTION.",
  `OBJECT-COMPUTER. AWS-${region}.`,
  "DATA DIVISION.",
  "WORKING-STORAGE SECTION.",
];

/** 1 リソースだけのプログラム。type と、項目（`    05  NAME PIC X(40) VALUE "..."` の形）を渡す。 */
function program(type: string, rows: string[], opts: { region?: string; moves?: string[] } = {}): string {
  return cards(
    ...head(opts.region),
    "01  R.",
    `    05  RESOURCE-TYPE PIC X(60) VALUE\n        "${type}".`,
    ...rows,
    "PROCEDURE DIVISION.",
    "MAIN-PARA.",
    ...(opts.moves ?? []),
    "    STOP RUN.",
  );
}

const lit = (name: string, value: string): string => `    05  ${name} PIC X(60) VALUE\n        "${value}".`;

function errorOf(src: string): CobolError {
  try {
    compile(src);
  } catch (e) {
    if (e instanceof CobolError) return e;
    throw e;
  }
  throw new Error("エラーになるはずが成功した");
}

const resourceOf = (src: string): any => Object.values(compile(src).template["Resources"] as Record<string, unknown>)[0];

describe("項目名の綴り間違いは黙って捨てない", () => {
  it("未知の項目は UNKNOWN-PROPERTY で、近い名前をヒントに出す", () => {
    const e = errorOf(program("AWS::EC2::VPC", [lit("VPC-CIDR", "10.0.0.0/16"), lit("VPC-DNS-SUPORT", "Y")]));
    expect(e.code).toBe("UNKNOWN-PROPERTY");
    expect(e.message).toContain("VPC-DNS-SUPORT");
    expect(e.message).toContain("もしかして VPC-DNS-SUPPORT");
  });

  it("安全設定の書き損じを見逃さない（RDS の暗号化）", () => {
    const e = errorOf(program("AWS::RDS::DBInstance", [lit("DB-CLASS", "db.t4g.micro"), lit("DB-ENCRYPTD", "N")]));
    expect(e.code).toBe("UNKNOWN-PROPERTY");
  });
});

describe("値の検査", () => {
  it("必須項目が無ければ MISSING-PROPERTY", () => {
    expect(errorOf(program("AWS::EC2::VPC", [])).code).toBe("MISSING-PROPERTY");
  });

  it("列挙値の外は INVALID-VALUE", () => {
    const e = errorOf(program("AWS::ElasticLoadBalancingV2::LoadBalancer", [lit("LB-SUBNETS", "subnet-1"), lit("LB-TYPE", "classic")]));
    expect(e.code).toBe("INVALID-VALUE");
    expect(e.message).toContain("application");
  });

  it('bool は "Y" か "N" だけ', () => {
    const e = errorOf(program("AWS::EC2::VPC", [lit("VPC-CIDR", "10.0.0.0/16"), lit("VPC-DNS-SUPPORT", "yes")]));
    expect(e.code).toBe("INVALID-VALUE");
  });

  it("DELETION-POLICY は Delete / Retain / Snapshot だけ", () => {
    const e = errorOf(program("AWS::EC2::VPC", [lit("VPC-CIDR", "10.0.0.0/16"), lit("DELETION-POLICY", "Maybe")]));
    expect(e.code).toBe("INVALID-VALUE");
  });
});

describe("Security by default", () => {
  it("EC2 は IMDSv2 必須が既定", () => {
    const r = resourceOf(program("AWS::EC2::Instance", [lit("EC2-AMI", "ami-123"), lit("EC2-TYPE", "t3.micro")]));
    expect(r.Properties.MetadataOptions.HttpTokens).toBe("required");
  });

  it("RDS は暗号化あり・非公開が既定で、パスワードは RDS に管理させる", () => {
    const r = resourceOf(program("AWS::RDS::DBInstance", [lit("DB-CLASS", "db.t4g.micro"), lit("DB-USER", "admin")]));
    expect(r.Properties.StorageEncrypted).toBe(true);
    expect(r.Properties.PubliclyAccessible).toBe(false);
    expect(r.Properties.ManageMasterUserPassword).toBe(true);
  });

  it("RDS の平文パスワードは書けない", () => {
    const e = errorOf(program("AWS::RDS::DBInstance", [lit("DB-CLASS", "db.t4g.micro"), lit("DB-USER", "admin"), lit("DB-PASSWORD", "hunter2")]));
    expect(e.code).toBe("PLAIN-PASSWORD");
    expect(e.message).not.toContain("hunter2"); // 値をエラーに出さない
  });

  it("SECRET: の参照なら通り、動的参照になる", () => {
    const r = resourceOf(
      program("AWS::RDS::DBInstance", [lit("DB-CLASS", "db.t4g.micro"), lit("DB-USER", "admin"), lit("DB-PASSWORD", "SECRET:prod/db:SecretString:password")]),
    );
    expect(r.Properties.MasterUserPassword).toBe("{{resolve:secretsmanager:prod/db:SecretString:password}}");
    expect(r.Properties.ManageMasterUserPassword).toBeUndefined();
  });

  it("DB を公開すると警告する", () => {
    const r = compile(program("AWS::RDS::DBInstance", [lit("DB-CLASS", "db.t4g.micro"), lit("DB-PUBLIC", "Y")]));
    expect(r.warnings.some((w) => w.code === "DB-PUBLIC")).toBe(true);
  });
});

describe("セキュリティグループ", () => {
  const sg = (cidr: string, from: number, to: number): string =>
    program(
      "AWS::EC2::SecurityGroup",
      [
        lit("SG-DESCRIPTION", "test"),
        "    05  WEB-INGRESS OCCURS 1 TIMES.",
        "        10  WEB-ING-PROTO PIC X(4).",
        "        10  WEB-ING-FROM  PIC 9(5).",
        "        10  WEB-ING-TO    PIC 9(5).",
        "        10  WEB-ING-CIDR  PIC X(18).",
      ],
      { moves: [`    MOVE "tcp" TO WEB-ING-PROTO (1).`, `    MOVE ${from} TO WEB-ING-FROM (1).`, `    MOVE ${to} TO WEB-ING-TO (1).`, `    MOVE "${cidr}" TO WEB-ING-CIDR (1).`] },
    );

  it("SSH を 0.0.0.0/0 に開くと警告する", () => {
    expect(compile(sg("0.0.0.0/0", 22, 22)).warnings.some((w) => w.code === "OPEN-TO-THE-WORLD")).toBe(true);
  });

  it("範囲に SSH を含む開放も警告する", () => {
    expect(compile(sg("0.0.0.0/0", 0, 1024)).warnings.some((w) => w.code === "OPEN-TO-THE-WORLD")).toBe(true);
  });

  it("HTTP の開放や、社内向けの SSH は警告しない", () => {
    expect(compile(sg("0.0.0.0/0", 80, 80)).warnings.some((w) => w.code === "OPEN-TO-THE-WORLD")).toBe(false);
    expect(compile(sg("10.0.0.0/8", 22, 22)).warnings.some((w) => w.code === "OPEN-TO-THE-WORLD")).toBe(false);
  });

  it("ルールを書いた行ごとに、1 件のルールになる", () => {
    const r = resourceOf(sg("0.0.0.0/0", 80, 80));
    expect(r.Properties.SecurityGroupIngress).toEqual([{ IpProtocol: "tcp", FromPort: 80, ToPort: 80, CidrIp: "0.0.0.0/0" }]);
  });

  it("MOVE していない空のルール行はエラー", () => {
    const e = errorOf(
      program("AWS::EC2::SecurityGroup", [
        lit("SG-DESCRIPTION", "test"),
        "    05  WEB-INGRESS OCCURS 1 TIMES.",
        "        10  WEB-ING-PROTO PIC X(4).",
      ]),
    );
    expect(e.code).toBe("MISSING-PROPERTY");
  });
});

describe("ロードバランサーとリスナー", () => {
  it("リスナーは転送かリダイレクトのどちらか 1 つだけ", () => {
    const none = errorOf(program("AWS::ElasticLoadBalancingV2::Listener", [lit("LSN-LB", "arn:x"), lit("LSN-PORT", "80")]));
    expect(none.code).toBe("MISSING-PROPERTY");
  });

  it("リダイレクトのリスナーは Type が redirect になる", () => {
    const r = resourceOf(
      program("AWS::ElasticLoadBalancingV2::Listener", [
        lit("LSN-LB", "arn:x"),
        lit("LSN-PROTOCOL", "HTTP"),
        lit("LSN-REDIRECT-PROTO", "HTTPS"),
        lit("LSN-REDIRECT-PORT", "443"),
        lit("LSN-REDIRECT-CODE", "HTTP_301"),
      ]),
    );
    expect(r.Properties.DefaultActions[0].Type).toBe("redirect");
  });

  it("HTTPS のリスナーには証明書が必要", () => {
    const e = errorOf(
      program("AWS::ElasticLoadBalancingV2::Listener", [lit("LSN-LB", "arn:x"), lit("LSN-PROTOCOL", "HTTPS"), lit("LSN-TARGET-GROUP", "arn:tg")]),
    );
    expect(e.code).toBe("MISSING-PROPERTY");
    expect(e.message).toContain("LSN-CERT");
  });

  it("NLB は LB-TYPE で切り替わる", () => {
    const r = resourceOf(program("AWS::ElasticLoadBalancingV2::LoadBalancer", [lit("LB-SUBNETS", "subnet-1"), lit("LB-TYPE", "network")]));
    expect(r.Properties.Type).toBe("network");
  });

  it("Classic LB には警告が出る", () => {
    const src = program(
      "AWS::ElasticLoadBalancing::LoadBalancer",
      ["    05  OLD-LISTENER OCCURS 1 TIMES.", "        10  OLD-LPORT PIC 9(3).", "        10  OLD-IPORT PIC 9(3).", "        10  OLD-LPROTO PIC X(4)."],
      { moves: ["    MOVE 80 TO OLD-LPORT (1).", "    MOVE 80 TO OLD-IPORT (1).", '    MOVE "HTTP" TO OLD-LPROTO (1).'] },
    );
    expect(compile(src).warnings.some((w) => w.code === "CLASSIC-LB")).toBe(true);
  });
});

describe("CloudFront と ACM", () => {
  const cdn = (region: string): string =>
    program(
      "AWS::CloudFront::Distribution",
      [lit("CDN-ORIGIN-DOMAIN", "origin.example.com"), lit("CDN-CERT", "arn:aws:acm:us-east-1:111111111111:certificate/x")],
      { region },
    );

  it("証明書つきの CloudFront を us-east-1 以外のスタックで作るとエラー", () => {
    const e = errorOf(cdn("AP-NORTHEAST-1"));
    expect(e.code).toBe("CLOUDFRONT-CERT-REGION");
    expect(e.message).toContain("AWS-US-EAST-1");
  });

  it("us-east-1 なら通り、SNI と TLS 1.2 が既定になる", () => {
    const r = resourceOf(cdn("US-EAST-1"));
    expect(r.Properties.DistributionConfig.ViewerCertificate).toMatchObject({ SslSupportMethod: "sni-only", MinimumProtocolVersion: "TLSv1.2_2021" });
    expect(r.Properties.DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy).toBe("redirect-to-https");
  });

  it("証明書が無ければ CloudFront の既定証明書を使う", () => {
    const r = resourceOf(program("AWS::CloudFront::Distribution", [lit("CDN-ORIGIN-DOMAIN", "origin.example.com")]));
    expect(r.Properties.DistributionConfig.ViewerCertificate).toEqual({ CloudFrontDefaultCertificate: true });
  });

  it("ホストゾーンを渡すと、ACM の DNS 検証にドメイン名が補われる", () => {
    const r = resourceOf(program("AWS::CertificateManager::Certificate", [lit("CERT-DOMAIN", "www.example.com"), lit("CERT-ZONE", "Z123")]));
    expect(r.Properties.DomainValidationOptions[0]).toEqual({ HostedZoneId: "Z123", DomainName: "www.example.com" });
  });

  it("キャッシュポリシー名は ID に置き換わる。知らない名前はエラー", () => {
    const ok = resourceOf(program("AWS::CloudFront::Distribution", [lit("CDN-ORIGIN-DOMAIN", "o.example.com"), lit("CDN-CACHE", "caching-optimized")]));
    expect(ok.Properties.DistributionConfig.DefaultCacheBehavior.CachePolicyId).toBe("658327ea-f89d-4fab-a63d-7e88639e58f6");
    const bad = errorOf(program("AWS::CloudFront::Distribution", [lit("CDN-ORIGIN-DOMAIN", "o.example.com"), lit("CDN-CACHE", "fastest")]));
    expect(bad.code).toBe("INVALID-VALUE");
  });
});

describe("リソース属性と依存", () => {
  it("DEPENDS-ON は論理 ID の DependsOn になる。無い名前はエラー", () => {
    const two = cards(
      ...head(),
      "01  A-IGW.",
      "    05  RESOURCE-TYPE PIC X(40) VALUE\n        \"AWS::EC2::InternetGateway\".",
      "01  B-ROUTE.",
      "    05  RESOURCE-TYPE PIC X(40) VALUE\n        \"AWS::EC2::Route\".",
      '    05  ROUTE-TABLE PIC X(10) VALUE "rtb-1".',
      '    05  ROUTE-DEST-CIDR PIC X(10) VALUE "0.0.0.0/0".',
      '    05  ROUTE-IGW PIC X(10) VALUE "REF:A-IGW".',
      '    05  DEPENDS-ON PIC X(10) VALUE "A-IGW".',
      "PROCEDURE DIVISION.",
    );
    expect((compile(two).template["Resources"] as any).BRoute.DependsOn).toBe("AIgw");

    const e = errorOf(two.replace('VALUE "A-IGW".', 'VALUE "NOPE".'));
    expect(e.code).toBe("UNDEFINED-REFERENCE");
  });

  it("DELETION-POLICY をリソースの属性として出す", () => {
    const r = resourceOf(program("AWS::EC2::VPC", [lit("VPC-CIDR", "10.0.0.0/16"), lit("DELETION-POLICY", "Retain")]));
    expect(r.DeletionPolicy).toBe("Retain");
  });

  it("NAME-TAG は Name タグになる", () => {
    const r = resourceOf(program("AWS::EC2::VPC", [lit("VPC-CIDR", "10.0.0.0/16"), lit("NAME-TAG", "main")]));
    expect(r.Properties.Tags).toEqual([{ Key: "Name", Value: "main" }]);
  });

  it("文字列の一覧は、要素ごとに REF: を解決する", () => {
    const src = cards(
      ...head(),
      "01  S-A.",
      "    05  RESOURCE-TYPE PIC X(40) VALUE\n        \"AWS::EC2::Subnet\".",
      '    05  SUBNET-VPC PIC X(10) VALUE "vpc-1".',
      '    05  SUBNET-CIDR PIC X(11) VALUE "10.0.1.0/24".',
      "01  LB.",
      "    05  RESOURCE-TYPE PIC X(60) VALUE\n        \"AWS::ElasticLoadBalancingV2::LoadBalancer\".",
      '    05  LB-SUBNETS PIC X(30) VALUE "REF:S-A, subnet-literal".',
      "PROCEDURE DIVISION.",
    );
    expect((compile(src).template["Resources"] as any).Lb.Properties.Subnets).toEqual([{ Ref: "SA" }, "subnet-literal"]);
  });
});

describe("メッセージング", () => {
  it("FIFO のキューは名前が .fifo で終わる必要がある", () => {
    const e = errorOf(program("AWS::SQS::Queue", [lit("QUEUE-NAME", "orders"), lit("QUEUE-FIFO", "Y")]));
    expect(e.code).toBe("INVALID-VALUE");
    expect(e.message).toContain(".fifo");
    expect(resourceOf(program("AWS::SQS::Queue", [lit("QUEUE-NAME", "orders.fifo"), lit("QUEUE-FIFO", "Y")])).Properties.FifoQueue).toBe(true);
  });

  it("DLQ を書いて回数を省くと 5 回、回数だけ書くとエラー", () => {
    const ok = resourceOf(program("AWS::SQS::Queue", [lit("QUEUE-DLQ", "arn:aws:sqs:ap-northeast-1:111111111111:dlq")]));
    expect(ok.Properties.RedrivePolicy.maxReceiveCount).toBe(5);
    const bad = errorOf(program("AWS::SQS::Queue", ["    05  QUEUE-MAX-RECEIVES PIC 9(2) VALUE 3."]));
    expect(bad.code).toBe("MISSING-PROPERTY");
  });

  it("キューは暗号化が既定で、無効にすると警告する", () => {
    expect(resourceOf(program("AWS::SQS::Queue", [])).Properties.SqsManagedSseEnabled).toBe(true);
    expect(compile(program("AWS::SQS::Queue", [lit("QUEUE-SSE", "N")])).warnings.some((w) => w.code === "SQS-UNENCRYPTED")).toBe(true);
  });

  it("キューポリシーは、SNS トピックからの送信だけを許す文になる", () => {
    const r = resourceOf(
      program("AWS::SQS::QueuePolicy", [lit("QPOL-QUEUES", "https://q"), lit("QPOL-QUEUE-ARN", "arn:q"), lit("QPOL-SNS-TOPIC", "arn:t")]),
    );
    expect(r.Properties.PolicyDocument.Statement[0]).toMatchObject({
      Effect: "Allow",
      Principal: { Service: "sns.amazonaws.com" },
      Action: "sqs:SendMessage",
      Resource: "arn:q",
      Condition: { ArnEquals: { "aws:SourceArn": "arn:t" } },
    });
  });

  it("SNS の購読: http とメールには注意を出す。未知のプロトコルはエラー", () => {
    const sub = (proto: string) => program("AWS::SNS::Subscription", [lit("SUB-TOPIC", "arn:t"), lit("SUB-PROTOCOL", proto), lit("SUB-ENDPOINT", "x")]);
    expect(compile(sub("http")).warnings.some((w) => w.code === "SNS-PLAIN-HTTP")).toBe(true);
    expect(compile(sub("email")).warnings.some((w) => w.code === "SNS-NEEDS-CONFIRM")).toBe(true);
    expect(errorOf(sub("pigeon")).code).toBe("INVALID-VALUE");
  });
});

describe("コンテナ", () => {
  const svc = (extra: string[]): string =>
    program("AWS::ECS::Service", [lit("SVC-CLUSTER", "c"), lit("SVC-TASK", "t"), lit("SVC-SUBNETS", "subnet-1"), ...extra]);

  it("ECS サービスは、パブリック IP を付けないのが既定", () => {
    const r = resourceOf(svc([]));
    expect(r.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp).toBe("DISABLED");
    expect(r.Properties.LaunchType).toBe("FARGATE");
  });

  it("パブリック IP を付けると警告する", () => {
    expect(compile(svc([lit("SVC-PUBLIC-IP", "ENABLED")])).warnings.some((w) => w.code === "TASK-PUBLIC-IP")).toBe(true);
  });

  it("ロードバランサーとの接続は、3 項目がそろわないとエラー", () => {
    expect(errorOf(svc([lit("SVC-TARGET-GROUP", "arn:tg")])).code).toBe("MISSING-PROPERTY");
  });

  it("タスク定義: ログ出力先を渡すと awslogs の設定が補われ、無ければ警告する", () => {
    const base = [lit("TD-CPU", "256"), lit("TD-MEMORY", "512"), lit("TD-CONTAINER-NAME", "web"), lit("TD-IMAGE", "nginx")];
    const withLogs = resourceOf(program("AWS::ECS::TaskDefinition", [...base, lit("TD-LOG-GROUP", "/app")]));
    expect(withLogs.Properties.ContainerDefinitions[0].LogConfiguration).toMatchObject({
      LogDriver: "awslogs",
      Options: { "awslogs-group": "/app", "awslogs-region": "ap-northeast-1", "awslogs-stream-prefix": "ecs" },
    });
    expect(compile(program("AWS::ECS::TaskDefinition", base)).warnings.some((w) => w.code === "ECS-NO-LOGS")).toBe(true);
  });

  it("ロググループの保持日数は、CloudWatch が許す値だけ。書かなければ 30 日", () => {
    expect(resourceOf(program("AWS::Logs::LogGroup", [])).Properties.RetentionInDays).toBe(30);
    expect(errorOf(program("AWS::Logs::LogGroup", ["    05  LOG-RETENTION-DAYS PIC 9(2) VALUE 10."])).code).toBe("INVALID-VALUE");
  });

  it("EKS: API が公開のままなら警告し、NG-MIN が NG-MAX を超えるとエラー", () => {
    const cluster = program("AWS::EKS::Cluster", [lit("EKS-ROLE", "arn:role"), lit("EKS-SUBNETS", "subnet-1,subnet-2")]);
    expect(compile(cluster).warnings.some((w) => w.code === "EKS-PUBLIC-API")).toBe(true);
    expect(resourceOf(cluster).Properties.AccessConfig.AuthenticationMode).toBe("API");
    const closed = program("AWS::EKS::Cluster", [lit("EKS-ROLE", "arn:role"), lit("EKS-SUBNETS", "subnet-1"), lit("EKS-PUBLIC-ENDPOINT", "N")]);
    expect(compile(closed).warnings.some((w) => w.code === "EKS-PUBLIC-API")).toBe(false);

    const ng = (min: number, max: number) =>
      program("AWS::EKS::Nodegroup", [
        lit("NG-CLUSTER", "c"),
        lit("NG-ROLE", "arn:r"),
        lit("NG-SUBNETS", "subnet-1"),
        `    05  NG-MIN PIC 9 VALUE ${min}.`,
        `    05  NG-MAX PIC 9 VALUE ${max}.`,
      ]);
    expect(errorOf(ng(3, 1)).code).toBe("INVALID-VALUE");
    expect(resourceOf(ng(1, 3)).Properties.ScalingConfig).toEqual({ MinSize: 1, MaxSize: 3 });
  });

  it("IAM ロールは、カンマ区切りで複数の管理ポリシーを付けられる", () => {
    const r = resourceOf(
      program("AWS::IAM::Role", [lit("TRUST-SERVICE", "ec2.amazonaws.com"), lit("MANAGED-POLICY", "AWS-MANAGED:PolicyA,AWS-MANAGED:PolicyB")]),
    );
    expect(r.Properties.ManagedPolicyArns).toEqual(["arn:aws:iam::aws:policy/PolicyA", "arn:aws:iam::aws:policy/PolicyB"]);
  });
});

describe("キャッシュ", () => {
  it("ElastiCache は、保管時・転送時の暗号化が既定", () => {
    const r = resourceOf(program("AWS::ElastiCache::ReplicationGroup", [lit("CACHE-DESCRIPTION", "x"), lit("CACHE-NODE-TYPE", "cache.t4g.micro")]));
    expect(r.Properties.AtRestEncryptionEnabled).toBe(true);
    expect(r.Properties.TransitEncryptionEnabled).toBe(true);
  });

  it("暗号化を切ると警告し、1 ノードのフェイルオーバーはエラー", () => {
    const off = compile(program("AWS::ElastiCache::ReplicationGroup", [lit("CACHE-DESCRIPTION", "x"), lit("CACHE-NODE-TYPE", "t"), lit("CACHE-IN-TRANSIT", "N")]));
    expect(off.warnings.some((w) => w.code === "CACHE-UNENCRYPTED")).toBe(true);
    const single = program("AWS::ElastiCache::ReplicationGroup", [
      lit("CACHE-DESCRIPTION", "x"),
      lit("CACHE-NODE-TYPE", "t"),
      lit("CACHE-FAILOVER", "Y"),
      "    05  CACHE-NODES PIC 9 VALUE 1.",
    ]);
    expect(errorOf(single).code).toBe("INVALID-VALUE");
  });
});

describe("3 層構成の落ち", () => {
  it("ALB + EC2 + RDS がそろうと、1998 年からの警告が出る", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dirname, "golden", "three-tier", "input.cbl"), "utf8");
    const w = compile(src).warnings.find((x) => x.code === "CLASSIC-THREE-TIER");
    expect(w?.message).toContain("1998");
  });

  it("2 層だけなら出ない", () => {
    const src = program("AWS::RDS::DBInstance", [lit("DB-CLASS", "db.t4g.micro")]);
    expect(compile(src).warnings.some((x) => x.code === "CLASSIC-THREE-TIER")).toBe(false);
  });
});
