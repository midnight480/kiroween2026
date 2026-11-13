---
inclusion: always
---

# Product: cobolform (COBOL DEPLOY DIVISION)

cobolform turns **real fixed-format COBOL** into **AWS CloudFormation**. A `01` group is a resource, a `VALUE` is a
property, `SELECT ... ASSIGN TO` plus `FD` is a managed database, and `CALL "DEPLOY"` declares the intent to deploy.
It is an entry for Kiroween 2026 (category: Resurrection).

## Principles

- **Valid COBOL first.** Every sample must pass `cobc -fsyntax-only --fixed` (GnuCOBOL). No custom reserved words, no `EXEC SQL`.
  IaC meaning comes from conventions, not new syntax.
- **A static transpiler, not CDK.** The `.cbl` is never executed; it is parsed as text. Do not describe the project as a CDK
  language binding or as using jsii. "A new CDK language" is only a metaphor for the developer experience.
- **Say only what was verified.** The README has a "Verified so far" section. A claim goes there only after a real run or a test.
  Resource types that CloudFormation accepted as a ChangeSet but were never deployed must be described that way.
- **Secure by default, loud about danger.** Unsafe choices are warnings or errors, never silent.

## Scope

- Supported: 46 resource types across Network, Compute, Databases, containers (ECS, EKS), messaging (SQS, SNS), the edge
  (CloudFront, ACM, Route 53), plus S3, IAM, Lambda and DynamoDB (single table and MRSC).
- Not supported, and must stay an explicit error rather than being ignored: any other resource type, `PERFORM`, arithmetic,
  `IF`/`EVALUATE`, cross-file references, `Parameters`/`Outputs`/`Conditions`/`Mappings`.
- Aurora DSQL is a stretch goal. Deploying from the browser is out of scope: the browser only compiles.

## Names

Package `cobolform`, short command `cobf` (both are the same binary). Never use a name containing `cdk`.
