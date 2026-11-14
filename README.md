# COBOL DEPLOY DIVISION (`cobolform`)

[日本語版 / Japanese](README_ja.md)

**Demo video (2:57):** https://www.youtube.com/watch?v=YhqlqcMIz-k

> Pure fixed-format COBOL in, AWS CloudFormation out.
> **"Pure fixed-format COBOL, now deploying multi-region AWS — `CALL "DEPLOY".`"**

An entry for [Kiroween 2026](https://kiroween.devpost.com/) (Devpost, 2026-10-30 to 2026-12-04; deadline JST 2026-12-05 07:00). The target category is **Resurrection**, with Frankenstein and Costume Contest as secondary fits.

> **Status: early implementation.** `cobf compile` turns COBOL into CloudFormation for 46 resource types across Network, Compute, Databases, containers (ECS, EKS), messaging (SQS, SNS) and the edge (CloudFront, ACM, Route 53), plus S3, IAM, Lambda and DynamoDB, and the output passes `cfn-lint`. `cobf deploy` and `cobf destroy` work end to end, and S3, IAM, Lambda, DynamoDB (including MRSC), a full three-tier stack (VPC, ALB, EC2 Auto Scaling, RDS), an SNS-to-SQS pipeline and an ECS Fargate service have been deployed to a real AWS account. The browser demo and the quirk features (card-reader errors, lower-case "heresy", DB link ghost) are built. Per the hackathon rules, only code written during the contest period counts.

## Concept

COBOL is not dead. It still runs core systems in Japanese municipalities and financial institutions. But as a language for building cloud infrastructure, it does not exist.

This project brings COBOL back as an infrastructure-as-code language. You write a real fixed-format COBOL program, and a custom transpiler turns it into CloudFormation.

- A `01` group item is a resource.
- A `VALUE` clause is a property.
- `SELECT ... ASSIGN TO` plus `FD` is a managed database.
- `CALL "DEPLOY"` declares the intent to deploy.

The author once analyzed a COBOL and Pro\*COBOL application, with Oracle 8i behind it, in order to convert it to Java. Oracle 8i could not be clustered at the time, so the application kept its databases redundant by having them exchange data with each other over DB links. Today the same intent is a few lines of COBOL that declare a multi-region, strongly consistent DynamoDB table.

### Not CDK, not jsii

CDK's multi-language support works through jsii, which calls one TypeScript implementation from other languages. This project is different. It is a **static transpiler**: it never executes the `.cbl` file. It parses the source as text and emits CloudFormation. "A new CDK language" is only a metaphor for the developer experience.

## Example

A multi-region, strongly consistent DynamoDB table (MRSC) with replicas in Tokyo and Osaka and a witness in Seoul:

```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. ORDER-DB.
000300 ENVIRONMENT DIVISION.
000400 CONFIGURATION SECTION.
000450 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.
000500 INPUT-OUTPUT SECTION.
000550 FILE-CONTROL.
000600     SELECT ORDERS-FILE ASSIGN TO "DYNAMODB-MRSC"
000700         ORGANIZATION IS INDEXED
000800         ACCESS MODE IS DYNAMIC
000900         RECORD KEY IS ORDER-ID
001000         ALTERNATE RECORD KEY IS ORDER-STATE WITH DUPLICATES
001100         FILE STATUS IS WS-FS.
001200 DATA DIVISION.
001300 FILE SECTION.
001400 FD  ORDERS-FILE.
001500 01  ORDER-REC.
001600     05  ORDER-ID         PIC X(36).
001700     05  ORDER-STATE      PIC X(10).
001800     05  ORDER-AMOUNT     PIC 9(9).
001900 WORKING-STORAGE SECTION.
002000 01  WS-FS                PIC XX.
002100 01  ORDERS-FILE-REGIONS.
002200     05  REPLICA-1        PIC X(20) VALUE "ap-northeast-1".
002300     05  REPLICA-2        PIC X(20) VALUE "ap-northeast-3".
002400     05  WITNESS-REGION   PIC X(20) VALUE "ap-northeast-2".
002500 PROCEDURE DIVISION.
002600 MAIN-PARA.
002700     CALL "DEPLOY".
002800     STOP RUN.
```

Mapping: `RECORD KEY` becomes the partition key, `ALTERNATE RECORD KEY` becomes a GSI, and `ASSIGN TO "DYNAMODB-MRSC"` becomes `AWS::DynamoDB::GlobalTable` with a top-level `MultiRegionConsistency: STRONG`, two `Replicas` and one entry in `GlobalTableWitnesses`.

## Language design

The guiding rule is **"valid COBOL first"**. Every sample must pass GnuCOBOL's fixed-format syntax check. There are no custom reserved words and no Pro\*COBOL or `EXEC SQL`. IaC meaning comes from conventions.

| COBOL construct | Infrastructure meaning |
|---|---|
| `PROGRAM-ID` | Stack name |
| `OBJECT-COMPUTER` | Primary region (for example `AWS-AP-NORTHEAST-1` becomes `ap-northeast-1`) |
| `01` group item | A resource (logical ID is the PascalCase of the name) |
| `05 RESOURCE-TYPE ... VALUE "AWS::S3::Bucket"` | CloudFormation resource type |
| Lower-level items and `VALUE` | Properties |
| `PIC X(n)` / `PIC 9(n)` | String / number, with the length enforced (a `VALUE` longer than `n` is an error) |
| `OCCURS n TIMES` | Arrays (IAM statements, tags) |
| `"REF:NAME"` / `"GETATT:NAME.ATTR"` | `Ref` / `Fn::GetAtt` (same-file references only) |
| `SELECT ... ASSIGN TO "DYNAMODB"`, `"DYNAMODB-MRSC"`, `"AURORA-DSQL"` | Managed database declarations |
| `ASSIGN TO "DBLINK"` | Deliberate error: the era of DB-link redundancy is over |
| `CALL "DEPLOY"` / `"DESTROY"` / `"DIFF"` | Declared default action |

### Supported resources

The mapping from COBOL to CloudFormation is a table in [`src/mapping/`](src/mapping/), one row per property. A single engine reads it, so adding a resource type means adding rows, not code. Every property name and enum value in the table is checked against the official CloudFormation schemas bundled with `cfn-lint`, so a typo in the table fails a test instead of a deployment.

| Area | Resource types |
|---|---|
| Network | VPC, Subnet, InternetGateway, VPCGatewayAttachment, RouteTable, Route, SubnetRouteTableAssociation, EIP, NatGateway, SecurityGroup (with inline ingress and egress rules), SecurityGroupIngress, SecurityGroupEgress |
| Edge | Route 53 HostedZone and RecordSet, ACM Certificate, CloudFront Distribution |
| Compute | EC2 Instance, IAM InstanceProfile, LaunchTemplate, AutoScalingGroup, Application and Network Load Balancer (one type, switched by `LB-TYPE`), TargetGroup, Listener, Classic Load Balancer |
| Databases | RDS DBInstance, DBSubnetGroup, Aurora DBCluster, ElastiCache (SubnetGroup, ReplicationGroup, CacheCluster), DynamoDB (single table and MRSC global table) |
| Containers | ECS Cluster, TaskDefinition (one container, environment table) and Service, EKS Cluster and Nodegroup, CloudWatch Logs LogGroup |
| Messaging | SQS Queue (FIFO, dead-letter queue) and QueuePolicy, SNS Topic and Subscription |
| Core | S3 Bucket, IAM Role and ManagedPolicy, Lambda Function |

Conventions that apply to every table-driven resource:

- A misspelled item is an error with a "did you mean" hint, never silently ignored. A typo in a safety setting must not disappear.
- Secure defaults: EC2 and launch templates require IMDSv2, EBS volumes are encrypted, RDS is encrypted and not public, and a database user without a password gets a password managed by RDS. A plain-text password is an error; use `SECRET:` or `SSM:`.
- Warnings for dangerous choices: SSH, RDP or a database port open to `0.0.0.0/0`, a public database, IMDSv1, a Classic Load Balancer, a public Kubernetes API server, a task with a public IP, an unencrypted queue or cache, plain HTTP or unconfirmed e-mail SNS subscriptions.
- More secure defaults: ECS tasks get no public IP, EKS uses access entries (API authentication), SQS queues use SSE, ElastiCache encrypts at rest and in transit, and log groups keep 30 days unless told otherwise.
- `DEPENDS-ON`, `DELETION-POLICY` and `NAME-TAG` work on every resource. `AMI` values can be `SSM:/aws/service/...`.
- CloudFront with a certificate must be in `AWS-US-EAST-1`, because that is the only region CloudFront accepts certificates from. Anything else is an error.

When a program contains a load balancer, EC2 and RDS together, the compiler adds one last line: the classic three-tier architecture again, and 1998 would like it back. See [`examples/three-tier.cbl`](examples/three-tier.cbl).

Aurora DSQL is a stretch goal.

### Fixed-format rules

| Columns | Area | Treatment |
|---|---|---|
| 1-6 | Sequence numbers | Optional; must ascend with `--strict-sequence` |
| 7 | Indicator | `*` comment, `-` continuation, `D` debug line |
| 8-11 | Area A | Divisions, sections, paragraphs, `FD`, `01` and `77` levels |
| 12-72 | Area B | Statements and subordinate items |
| 73-80 | Identification | Ignored; writing a value here raises a warning |

Additional quirks: upper case is enforced outside string literals, tabs are rejected, and lines over 80 columns are errors.

## Documentation

- [docs/GUIDE.md](docs/GUIDE.md): a step-by-step guide, from your first program to deploying it. Every program in it is checked by a test.
- [docs/REFERENCE.md](docs/REFERENCE.md): every resource type, with each COBOL item, the CloudFormation property it becomes, allowed values, defaults and the warnings it can raise. It is generated from the mapping tables, so it cannot drift from the code.
- [docs/DESIGN.md](docs/DESIGN.md): the design notes (in Japanese).

The guide and the reference are in English.

## Getting started

The package is not published to npm yet, so build it from source. It needs Node.js 20 or later. GnuCOBOL is optional.

```
npm install
npm run build
node dist/cli.js compile verify/samples/51-s3.cbl
```

Once published, the same commands will run through `npx cobf ...`.

### Browser demo

```
npm run web:build
cd web && python3 -m http.server 8791 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8791/`. A green-screen CRT editor with an 80-column ruler (guides at columns 7, 12 and 72) sits next to a virtual line printer on green-bar paper. Compilation runs entirely inside the page, so no AWS credentials ever reach the browser. Errors print in blood-red ink, and `ASSIGN TO "DBLINK"` summons the ghost of the 8i servers. The dot-impact sound is off by default. Real deployments are not part of the page; use `cobf deploy`. The page is in English by default. Use the button in the top right, or add `?lang=ja` to the address, for Japanese.

## CLI

The package installs one binary under two command names: `cobolform` and the short alias `cobf`. `compile`, `diff`, `deploy` and `destroy` are all implemented. `diff` creates a ChangeSet only to show it, never executes it, and always deletes it afterwards.

```
cobf compile <file.cbl> [--format json|yaml]   # CloudFormation only, no side effects
cobf diff    <file.cbl>                         # ChangeSet diff against the existing stack
cobf deploy  <file.cbl> [--yes | --force]       # ChangeSet create -> execute -> 132-column report
cobf destroy <file.cbl> [--yes | --force]       # Delete the stack (confirmation by default)
```

An explicit CLI subcommand always wins. If it is omitted, the `CALL` statement in the `.cbl` file is the default action. `compile` is the foundation for golden tests and CI. `--yes` skips the confirmation prompt for non-interactive runs. `--strict-sequence` works with any command and rejects out-of-order sequence numbers. `--lang en|ja` picks the language of messages and help; without it the CLI uses `COBF_LANG`, then the locale (Japanese for a Japanese locale, English otherwise).

## Architecture

```
.cbl -> [1] Card Reader -> [2] Parser -> AST -> [3] Semantic
     -> [4] IR -> [5] Emitter (CloudFormation JSON/YAML)
     -> [6] Line-printer reporter (132 columns) / Deployer (CloudFormation API)
```

- Implementation language: TypeScript on Node.js.
- Parser: hand-written, limited to the subset in the design notes. Anything outside it is an explicit `UNSUPPORTED-IN-MVP` error, never silently ignored.
- Deployment: AWS SDK for JavaScript v3 (`@aws-sdk/client-cloudformation`) with ChangeSets.
- Distribution: npm / `npx`. No COBOL runtime is required. GnuCOBOL is an optional dependency used only for the "is this real COBOL?" syntax check.

## Quirk features

All of these work today:

- Column-shift errors with the line and column, and parody IBM-style message numbers. For example `file.cbl:1:7: CBF-0003-S SEVERITY 12: ...`. The `CBF` prefix is our own; no real IBM message IDs are reused. Warnings use `SEVERITY 4`.
- `LOWERCASE IS HERESY` for lower-case source.
- `--strict-sequence`, which fails with "the card deck is out of order" when the sequence numbers in columns 1-6 do not ascend.
- A warning when `STOP RUN` is missing: "JOB DID NOT TERMINATE".
- A 132-column line-printer report for `deploy` and `destroy`, with page headers, page numbers, and a `TOTAL RESOURCES CREATED / UPDATED / DELETED` line.
- Failures shown as an `ABEND S0C7`-style dump. The failure handling logic is separate from this presentation layer, so exit codes stay reliable for CI.
- A warning for the "cursed wildcard" (`*`) in IAM actions, and secure defaults such as blocking public S3 access.
- `DBLINK` is a deliberate error.

## Verified so far

- **GnuCOBOL 3.2.0:** the four samples in [`verify/samples/`](verify/samples/) (`51-s3.cbl`, `52-lambda.cbl`, `53-policy.cbl`, `54-db.cbl`) pass `cobc -fsyntax-only --fixed`, and also pass in `-std=cobol85` mode.
- **Runtime check:** linked with the dummy [`deploy.cbl`](verify/samples/deploy.cbl) subprogram, the samples compile with `cobc -x` and run. This shows `CALL "DEPLOY"` resolves at run time like ordinary COBOL.
- **CloudFormation schema:** `AWS::DynamoDB::GlobalTable` can declare MRSC in a single stack. Tokyo, Osaka and Seoul all fall in the same AP region set, so the sample's witness placement is valid.
- **Transpiler output:** the golden cases in [`tests/golden/`](tests/golden/) (S3, IAM policy, Lambda, DynamoDB MRSC, and the three-tier, edge and classic examples) pass `cfn-lint`, and the Vitest suite passes.
- **Real CloudFormation, without creating anything:** `cobf diff` on the three-tier, classic, edge, containers, EKS, cache and messaging examples was accepted by CloudFormation as a ChangeSet. The ChangeSets were deleted and no stack was left behind.
- **Real AWS:** in a real account, `examples/smoke-s3.cbl` was deployed, redeployed (no changes) and destroyed. The bucket had versioning enabled and all four public-access blocks on, as the COBOL asked. The Lambda golden case (IAM role plus function) deployed and the function returned `{"statusCode":200}` when invoked. The policy golden case deployed with the bucket ARN resolved inside the policy document.
- **A real failure:** a deliberately invalid bucket name ended in `ROLLBACK_FAILED`. That exposed a bug where the report claimed the prior state was restored. It is fixed and covered by tests.

- **MRSC:** the DynamoDB golden case deployed as a strongly consistent global table with replicas in Tokyo and Osaka and a witness in Seoul. An item written in Tokyo was read back from Osaka with a consistent read. The first attempt failed once with a transient `UnrecognizedClientException` raised inside CloudFormation. Experiments with other global table shapes succeeded, and an unchanged retry succeeded, so it was not a template problem.

- **Three-tier:** `examples/three-tier.cbl` deployed 21 resources: a VPC, four subnets, an internet gateway, three security groups, an ALB, an Auto Scaling group and an RDS MySQL instance. The ALB answered `COBOL` over HTTP with the target `healthy`. Connecting to the instance directly was blocked, so the chain of security groups works. The instance requires IMDSv2, and RDS was encrypted, private, and used a Secrets Manager-managed password. `destroy` removed all 21 and nothing billable was left behind.
- **Messaging:** `examples/messaging.cbl` (SNS topic, SQS queue with a dead-letter queue, queue policy, subscription) deployed. A message published to the topic arrived in the queue unchanged. The queue was encrypted, its redrive policy pointed at the dead-letter queue after 3 receives, and the queue policy allowed `sqs:SendMessage` only from that topic.
- **Containers:** `examples/containers.cbl` deployed a Fargate service running nginx behind no load balancer. The task reached `RUNNING`, answered HTTP 200 on its public IP, passed the `GREETING` environment variable, and wrote to a CloudWatch log group with 7-day retention. Everything was deleted afterwards.
- **Update:** changing `VERSIONING-FLAG` from `"Y"` to `"N"` and deploying again updated the existing stack in place (`UPDATE_COMPLETE`), and the bucket's versioning went from Enabled to Suspended.

What is not verified yet: the edge resources (CloudFront, ACM, Route 53), the classic load balancer, EKS and ElastiCache examples have been accepted as ChangeSets but not deployed (ACM needs a real domain to validate, and EKS and ElastiCache cost money and take a while); and rollback of a failed update. The original `52-lambda.cbl` has no `Code` item, so it compiles with a warning but cannot be deployed. Use `FN-CODE-INLINE` or `FN-CODE-S3` as in `tests/golden/lambda/`. `53-policy.cbl` refers to a bucket defined in another file, so it fails on its own; references resolve within one file only.

```
cd verify/samples
cobc -fsyntax-only --fixed 51-s3.cbl
cobc -x -o run 51-s3.cbl deploy.cbl && ./run
```

## Roadmap

1. Done: card reader, parser and semantic checks, covered by Vitest and golden tests (`.cbl` to expected CloudFormation).
2. Done: emitters for S3, IAM, Lambda, DynamoDB, Network, Compute, Databases, containers, messaging and the edge, with `cfn-lint` on the golden outputs.
3. Mostly done: deployer and the 132-column report. Rollback of a failed update is still to be tried on a real account.
4. First version done: the browser demo, with a green-screen CRT editor and a virtual line printer that compile in the page. Still to do: an authenticated backend for real deployments, so AWS credentials never reach the browser.
5. Stretch: Aurora DSQL, CDK L1 output, security-policy checks with cfn-guard.

## Built with Kiro

The plan is to use Kiro Specs (requirements, design and tasks in EARS notation), Hooks (syntax check and CloudFormation generation on `.cbl` save), Steering (COBOL conventions and AWS security rules) and MCP (AWS documentation lookup).

## Repository layout

```
README.md / README_ja.md   This file
docs/GUIDE.md              Step-by-step guide (English)
docs/REFERENCE.md          Resource reference, generated from src/mapping (English)
docs/DESIGN.md             Full design notes (in Japanese)
docs/DEMO_SCRIPT.md        Script and shooting guide for the demo video (Japanese notes, English narration)
src/                       Transpiler and CLI (TypeScript)
tests/                     Vitest unit tests and golden cases
examples/                  Programs you can deploy (smoke-s3.cbl)
web/                       Browser demo (editor, line printer)
verify/samples/            GnuCOBOL-verified sample programs
```

## Related projects

- [yomiyasu](https://github.com/nanaism/yomiyasu): an Agent Skill by nanaism that refines AI-generated Japanese into natural, readable Japanese. It suits Japanese technical articles, design documents and PR descriptions, so it is a good fit for polishing this project's Japanese documents (`README_ja.md`, `docs/DESIGN.md`).

## Author

Tetsuya Shibao, AWS Community Builder (Security) and JAWS-UG Saga.

## License

MIT. See [LICENSE](LICENSE).
