# COBOL DEPLOY DIVISION (`cobolform`)

[日本語版 / Japanese](README_ja.md)

> Pure fixed-format COBOL in, AWS CloudFormation out.
> **"Pure fixed-format COBOL, now deploying multi-region AWS — `CALL "DEPLOY".`"**

An entry for [Kiroween 2026](https://kiroween.devpost.com/) (Devpost, 2026-10-30 to 2026-12-04; deadline JST 2026-12-05 07:00). The target category is **Resurrection**, with Frankenstein and Costume Contest as secondary fits.

> **Status: early implementation.** `cobf compile` turns COBOL into CloudFormation for S3, IAM, Lambda and DynamoDB (single table and MRSC), and the output passes `cfn-lint`. `cobf deploy` and `cobf destroy` work end to end, and all four MVP resource types (S3, IAM, Lambda, DynamoDB including MRSC) have been deployed to a real AWS account. The browser demo and most quirk features are not built yet. Per the hackathon rules, only code written during the contest period counts.

## Concept

COBOL is not dead. It still runs core systems in Japanese municipalities and financial institutions. But as a language for building cloud infrastructure, it does not exist.

This project brings COBOL back as an infrastructure-as-code language. You write a real fixed-format COBOL program, and a custom transpiler turns it into CloudFormation.

- A `01` group item is a resource.
- A `VALUE` clause is a property.
- `SELECT ... ASSIGN TO` plus `FD` is a managed database.
- `CALL "DEPLOY"` declares the intent to deploy.

The author once maintained an Oracle 8i system. Without clustering, redundancy there meant wiring DB links between several database servers by hand. Today the same intent is a few lines of COBOL that declare a multi-region, strongly consistent DynamoDB table.

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

MVP resource coverage: S3 bucket, IAM role and managed policy, Lambda function, and DynamoDB (single table and MRSC global table). Aurora DSQL is a stretch goal.

### Fixed-format rules

| Columns | Area | Treatment |
|---|---|---|
| 1-6 | Sequence numbers | Optional; must ascend with `--strict-sequence` |
| 7 | Indicator | `*` comment, `-` continuation, `D` debug line |
| 8-11 | Area A | Divisions, sections, paragraphs, `FD`, `01` and `77` levels |
| 12-72 | Area B | Statements and subordinate items |
| 73-80 | Identification | Ignored; writing a value here raises a warning |

Additional quirks: upper case is enforced outside string literals, tabs are rejected, and lines over 80 columns are errors.

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

Then open `http://127.0.0.1:8791/`. A green-screen CRT editor with an 80-column ruler (guides at columns 7, 12 and 72) sits next to a virtual line printer on green-bar paper. Compilation runs entirely inside the page, so no AWS credentials ever reach the browser. Errors print in blood-red ink, and `ASSIGN TO "DBLINK"` summons the ghost of the 8i servers. The dot-impact sound is off by default. Real deployments are not part of the page; use `cobf deploy`.

## CLI

The package installs one binary under two command names: `cobolform` and the short alias `cobf`. `compile`, `diff`, `deploy` and `destroy` are all implemented. `diff` creates a ChangeSet only to show it, never executes it, and always deletes it afterwards.

```
cobf compile <file.cbl> [--format json|yaml]   # CloudFormation only, no side effects
cobf diff    <file.cbl>                         # ChangeSet diff against the existing stack
cobf deploy  <file.cbl> [--yes | --force]       # ChangeSet create -> execute -> 132-column report
cobf destroy <file.cbl> [--yes | --force]       # Delete the stack (confirmation by default)
```

An explicit CLI subcommand always wins. If it is omitted, the `CALL` statement in the `.cbl` file is the default action. `compile` is the foundation for golden tests and CI. `--yes` skips the confirmation prompt for non-interactive runs. `--strict-sequence` works with any command and rejects out-of-order sequence numbers.

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
- **Transpiler output:** the golden cases in [`tests/golden/`](tests/golden/) (S3, IAM policy, Lambda, DynamoDB MRSC) pass `cfn-lint`, and the Vitest suite passes.
- **Real AWS:** in a real account, `examples/smoke-s3.cbl` was deployed, redeployed (no changes) and destroyed. The bucket had versioning enabled and all four public-access blocks on, as the COBOL asked. The Lambda golden case (IAM role plus function) deployed and the function returned `{"statusCode":200}` when invoked. The policy golden case deployed with the bucket ARN resolved inside the policy document.
- **A real failure:** a deliberately invalid bucket name ended in `ROLLBACK_FAILED`. That exposed a bug where the report claimed the prior state was restored. It is fixed and covered by tests.

- **MRSC:** the DynamoDB golden case deployed as a strongly consistent global table with replicas in Tokyo and Osaka and a witness in Seoul. An item written in Tokyo was read back from Osaka with a consistent read. The first attempt failed once with a transient `UnrecognizedClientException` raised inside CloudFormation. Experiments with other global table shapes succeeded, and an unchanged retry succeeded, so it was not a template problem.

- **Update:** changing `VERSIONING-FLAG` from `"Y"` to `"N"` and deploying again updated the existing stack in place (`UPDATE_COMPLETE`), and the bucket's versioning went from Enabled to Suspended.

What is not verified yet: rollback of a failed update. The original `52-lambda.cbl` has no `Code` item, so it compiles with a warning but cannot be deployed. Use `FN-CODE-INLINE` or `FN-CODE-S3` as in `tests/golden/lambda/`. `53-policy.cbl` refers to a bucket defined in another file, so it fails on its own; references resolve within one file only.

```
cd verify/samples
cobc -fsyntax-only --fixed 51-s3.cbl
cobc -x -o run 51-s3.cbl deploy.cbl && ./run
```

## Roadmap

1. Done: card reader, parser and semantic checks, covered by Vitest and golden tests (`.cbl` to expected CloudFormation).
2. Done: emitters for S3, IAM, Lambda and DynamoDB, with `cfn-lint` on the golden outputs.
3. Mostly done: deployer and the 132-column report. Rollback of a failed update is still to be tried on a real account.
4. First version done: the browser demo, with a green-screen CRT editor and a virtual line printer that compile in the page. Still to do: an authenticated backend for real deployments, so AWS credentials never reach the browser.
5. Stretch: Aurora DSQL, CDK L1 output, security-policy checks with cfn-guard.

## Built with Kiro

The plan is to use Kiro Specs (requirements, design and tasks in EARS notation), Hooks (syntax check and CloudFormation generation on `.cbl` save), Steering (COBOL conventions and AWS security rules) and MCP (AWS documentation lookup).

## Repository layout

```
README.md / README_ja.md   This file
docs/DESIGN.md             Full design notes (in Japanese)
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
