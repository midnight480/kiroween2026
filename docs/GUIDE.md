# Guide: write infrastructure in COBOL

This guide takes you from nothing to a deployed stack. Every program in it is real: each one compiles, and `tests/guide.test.ts` checks that. For the full list of resources and their items, see [REFERENCE.md](REFERENCE.md).

## 1. Install

You need Node.js 20 or later. GnuCOBOL (`cobc`) is optional; it is only used to prove a file is real COBOL.

```text
git clone https://github.com/midnight480/kiroween2026.git
cd kiroween2026
npm install
npm run build
```

The commands are `cobolform` and the short alias `cobf`. They are the same program. Until the package is published, run it as `node dist/cli.js`, or add an alias:

```text
alias cobf='node dist/cli.js'
```

## 2. Your first program

```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. HAUNTED-LOGS.
000300 AUTHOR. TETSUYA-SHIBAO.
000400 ENVIRONMENT DIVISION.
000500 CONFIGURATION SECTION.
000600 SOURCE-COMPUTER. AWS-ACCOUNT.
000700 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.
000800 DATA DIVISION.
000900 WORKING-STORAGE SECTION.
001000 01  LOGS-BUCKET.
001100     05  RESOURCE-TYPE    PIC X(20) VALUE "AWS::S3::Bucket".
001200     05  BUCKET-NAME      PIC X(63) VALUE "kiroween-crypt-logs".
001300     05  VERSIONING-FLAG  PIC X     VALUE "Y".
001400         88  VERSIONING-ON          VALUE "Y".
001500     05  BLOCK-PUBLIC     PIC X     VALUE "Y".
001600 PROCEDURE DIVISION.
001700 MAIN-PARA.
001800     CALL "DEPLOY".
001900     STOP RUN.
```

Compile it:

```text
cobf compile verify/samples/51-s3.cbl
```

The output is a CloudFormation template (JSON; add `--format yaml` for YAML). `compile` never touches AWS.

### What each part means

| COBOL | Meaning |
|---|---|
| `PROGRAM-ID. HAUNTED-LOGS.` | the CloudFormation **stack name** |
| `OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.` | the **region** to deploy to (`ap-northeast-1`) |
| `01  LOGS-BUCKET.` | one **resource**. The name becomes the logical ID `LogsBucket` |
| `05  RESOURCE-TYPE ... "AWS::S3::Bucket"` | the CloudFormation **type** |
| `05  BUCKET-NAME ... "kiroween-crypt-logs"` | a **property** |
| `CALL "DEPLOY".` | the default action when you run `cobf` on the file |

`PIC X(n)` is a string of at most `n` characters. A value longer than `n` is an error, so a bucket name is limited to 63 characters by its picture. `PIC 9(n)` is a number.

## 3. The columns matter

COBOL's fixed format is strict, and cobolform enforces it:

```text
         1         2         3         4         5         6         7
1234567890123456789012345678901234567890123456789012345678901234567890123456789012
000100 IDENTIFICATION DIVISION.
^^^^^^ columns 1-6: sequence number (optional)
      ^ column 7: indicator. space, * comment, - continuation, D debug
       ^^^ column 8: Area A starts here (divisions, sections, 01 levels)
           ^ column 12: Area B starts here (sub-items, statements)
                                                                        ^ column 72: the last column that is read
```

- Nothing after column 72 is read, and a line over 80 columns is an error.
- Tabs are not allowed. Reserved words and names are upper case.
- A long string is split with a **continuation line**: a `-` in column 7 and a quote in column 12. The first line must reach column 72.

Mistakes are reported with the line and column, and a message number:

```text
shift.cbl:1:7: CBF-0003-S SEVERITY 12: Column 7 may only hold a space, *, -, D or /. Found 'I'. Is the code shifted? [INVALID-INDICATOR]
lower.cbl:8:8: CBF-0007-S SEVERITY 12: LOWERCASE IS HERESY — Reserved words and data names must be upper case: working-storage [LOWERCASE-NOT-ALLOWED]
```

Warnings use `SEVERITY 4` and a `-W` number. Add `--strict-sequence` to also require the sequence numbers to ascend.

## 4. Two resources that refer to each other

`REF:NAME` points at another resource in the **same file**. In a policy `Resource`, it becomes the resource's ARN.

```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. CURSED-POLICY.
000250 ENVIRONMENT DIVISION.
000260 CONFIGURATION SECTION.
000270 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.
000300 DATA DIVISION.
000400 WORKING-STORAGE SECTION.
000410 01  LOGS-BUCKET.
000420     05  RESOURCE-TYPE    PIC X(20) VALUE "AWS::S3::Bucket".
000430     05  BUCKET-NAME      PIC X(63) VALUE "kiroween-crypt-logs".
000500 01  READ-ONLY-POLICY.
000600     05  RESOURCE-TYPE PIC X(25) VALUE "AWS::IAM::ManagedPolicy".
000700     05  STMT OCCURS 2 TIMES.
000800         10  STMT-EFFECT  PIC X(5).
000900         10  STMT-ACTION  PIC X(30).
001000         10  STMT-RES     PIC X(60).
001100 PROCEDURE DIVISION.
001200 MAIN-PARA.
001300     MOVE "Allow"             TO STMT-EFFECT (1).
001400     MOVE "s3:GetObject"      TO STMT-ACTION (1).
001500     MOVE "REF:LOGS-BUCKET/*" TO STMT-RES (1).
001600     MOVE "Allow"             TO STMT-EFFECT (2).
001700     MOVE "s3:ListBucket"     TO STMT-ACTION (2).
001800     MOVE "REF:LOGS-BUCKET"   TO STMT-RES (2).
001900     CALL "DEPLOY".
002000     STOP RUN.
```

- A policy statement is a row of an `OCCURS` table. You fill it with `MOVE` and a subscript, as above.
- `"REF:LOGS-BUCKET"` becomes the bucket's ARN, and `"REF:LOGS-BUCKET/*"` becomes the ARN plus `/*`.
- `GETATT:NAME.ATTR` reads an attribute (`GETATT:FN-ROLE.ARN` becomes `Fn::GetAtt` of `Arn`).
- A name that does not exist is an error, and so is a loop of references.

## 5. Network and a security group

```cobol
000100 IDENTIFICATION DIVISION.
000200 PROGRAM-ID. WEB-NETWORK.
000300 AUTHOR. COBOLFORM.
000400 ENVIRONMENT DIVISION.
000500 CONFIGURATION SECTION.
000600 OBJECT-COMPUTER. AWS-AP-NORTHEAST-1.
000700 DATA DIVISION.
000800 WORKING-STORAGE SECTION.
000900 01  WEB-VPC.
001000     05  RESOURCE-TYPE    PIC X(13) VALUE "AWS::EC2::VPC".
001100     05  VPC-CIDR             PIC X(11) VALUE "10.0.0.0/16".
001200     05  VPC-DNS-SUPPORT      PIC X(1) VALUE "Y".
001300     05  NAME-TAG             PIC X(3) VALUE "web".
001400 01  WEB-SG.
001500     05  RESOURCE-TYPE    PIC X(23)    VALUE "AWS::EC2::SecurityGr
001600-    "oup".
001700     05  SG-DESCRIPTION    PIC X(14) VALUE "Web from HTTPS".
001800     05  SG-VPC            PIC X(11) VALUE "REF:WEB-VPC".
001900     05  WEB-INGRESS OCCURS 1 TIMES.
002000         10  WEB-ING-PROTO      PIC X(4).
002100         10  WEB-ING-FROM       PIC 9(5).
002200         10  WEB-ING-TO         PIC 9(5).
002300         10  WEB-ING-CIDR       PIC X(18).
002400 PROCEDURE DIVISION.
002500 MAIN-PARA.
002600     MOVE "tcp" TO WEB-ING-PROTO (1).
002700     MOVE 443 TO WEB-ING-FROM (1).
002800     MOVE 443 TO WEB-ING-TO (1).
002900     MOVE "0.0.0.0/0" TO WEB-ING-CIDR (1).
003000     CALL "DEPLOY".
003100     STOP RUN.
```

A security group's rules are an `OCCURS` table too. The group is named `WEB-INGRESS` (any name that ends in `-INGRESS`), and its items end in `-PROTO`, `-FROM`, `-TO` and `-CIDR`. The values come from the `MOVE` statements. [REFERENCE.md](REFERENCE.md) lists the suffixes for every table.

Misspell an item and you are told, with a hint:

```text
typo.cbl:12:12: CBF-0048-S SEVERITY 12: AWS::EC2::VPC has no item named VPC-DNS-SUPORT (did you mean VPC-DNS-SUPPORT?) [UNKNOWN-PROPERTY]
```

Nothing is ever ignored silently. Open SSH to the world and you get a warning, but the template is still produced:

```text
ssh.cbl:14: CBF-0051-W SEVERITY 4: WEB-SG: SSH (22) is open to 0.0.0.0/0. A cursed wildcard [OPEN-TO-THE-WORLD]
```

### Safe by default

If you leave a safety setting out, the safe value is used. For example: EC2 requires IMDSv2, volumes and RDS are encrypted, RDS is not public and gets a managed password, ECS tasks get no public IP, S3 blocks public access. Choosing the unsafe value is allowed, but it is a warning. A plain-text password is an error.

## 6. Preview, deploy, destroy

These talk to AWS using your normal credentials (for example `AWS_PROFILE`). Deploy only to an account you are happy to experiment in, and remember that some resources cost money (load balancers, NAT gateways, RDS, EKS, ElastiCache).

```text
cobf diff examples/web-network.cbl
```

```text
* DIFF DIVISION   STACK=WEB-NETWORK   REGION=ap-northeast-1   RUN=<time>
* NEW STACK — ALL RESOURCES WOULD BE CREATED
  ADD      WebSg                    AWS::EC2::SecurityGroup
  ADD      WebVpc                   AWS::EC2::VPC
```

`diff` creates a ChangeSet only to show it. It never runs it and always deletes it. It is the cheapest way to find out whether CloudFormation accepts your template.

```text
cobf deploy  examples/web-network.cbl        # asks first; add --yes to skip
cobf destroy examples/web-network.cbl        # deletes the stack
```

`deploy` creates a ChangeSet, runs it, and prints the stack events on a 132-column line-printer report with page numbers and a total. A failure prints an `ABEND S0C7` style dump and exits with a non-zero code; it never claims a rollback succeeded when it did not. Without a subcommand, `cobf file.cbl` follows the `CALL "DEPLOY"` or `CALL "DESTROY"` in the file.

| Option | Meaning |
|---|---|
| `--yes`, `--force` | skip the confirmation (needed when there is no terminal, such as CI) |
| `--format json\|yaml` | output format of `compile` |
| `--strict-sequence` | require ascending sequence numbers |
| `--lang en\|ja` | message language. Default: `COBF_LANG`, then the locale (English unless it is Japanese) |

## 7. The browser demo

```text
npm run web:build
cd web && python3 -m http.server 8791 --bind 127.0.0.1
```

Open `http://127.0.0.1:8791/`. It is an editor and a virtual line printer. It compiles in the page and never sees AWS credentials. It cannot deploy; use the CLI for that.

## 8. What it does not do

cobolform is a transpiler for a **subset** of COBOL, on purpose. It rejects, with an explicit error, anything outside the subset: `PERFORM`, arithmetic, `IF` and `EVALUATE`, other `PIC` forms, references across files, and CloudFormation `Parameters`, `Outputs`, `Conditions` and `Mappings`. Resource types other than the 46 in [REFERENCE.md](REFERENCE.md) are an error too.

CloudFront, ACM, Route 53, the Classic Load Balancer, EKS and ElastiCache are accepted by CloudFormation as ChangeSets but have not been deployed in a real account yet.
