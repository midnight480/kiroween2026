---
inclusion: fileMatch
fileMatchPattern: ["src/mapping/**", "tests/schemas/**", "tests/mapping.test.ts", "scripts/extract-schemas.py"]
---

# Adding or changing a resource mapping

A resource type is a row set in `src/mapping/*.ts` (`ResourceSpec`), read by one engine (`engine.ts`). Do not add per-type code to the engine.

## Steps

1. Add the type to `TYPES` in `scripts/extract-schemas.py` and regenerate `tests/schemas/` (official CloudFormation schemas from cfn-lint).
2. Add the fields: COBOL name, CloudFormation path (a digit in the path is an array index), kind, `required`, `enum`, `default`.
3. If the official schema is an opaque `object` (RedrivePolicy, log `Options`, `PolicyDocument`), set `schemaPath` to the parent.
4. Put cross-field rules and warnings in `post` using the hook (`has`, `get`, `set`, `wrote`, `warn`, `fail`).
5. Run the tests. `tests/mapping.test.ts` checks every property name, enum, default and kind against the official schema, field name
   uniqueness across types, list suffix overlap, and COBOL reserved words. Fix the table, not the test.
6. Add an engine test for each new rule, a golden case if there is an example, and run `uvx cfn-lint` on the output.
7. Check the real service accepts it with `cobf diff` (creates and deletes a ChangeSet, costs nothing). Only deploy with the owner's approval.

## Rules the engine already enforces

- A misspelled item is `UNKNOWN-PROPERTY` with a "did you mean". Never make unknown items silently ignored.
- Plain-text passwords are `PLAIN-PASSWORD`; only `SECRET:` or `SSM:` is accepted.

## Secure defaults to keep

IMDSv2 required, EBS and RDS encrypted, RDS not public and with a managed master password, ECS tasks without a public IP, EKS with API
authentication, SQS server-side encryption, ElastiCache encrypted at rest and in transit, log groups kept 30 days, public S3 access blocked.
A new type should default to the safe choice and warn when the author overrides it.

## Messages

New error or warning codes go at the **end** of `CODES` in `src/errors.ts` (the order is the message number). Messages are written in
Japanese at the call site and **must** have an English entry in `src/i18n.ts` keyed by the exact source string (`${...}` becomes `$1`, `$2`).
`tests/i18n.test.ts` fails if any message has no English translation.
