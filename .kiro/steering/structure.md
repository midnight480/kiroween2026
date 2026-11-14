---
inclusion: always
---

# Project structure

```
src/                  compiler and CLI (TypeScript)
  card.ts lexer.ts parser.ts semantic.ts   fixed-format reader, tokens, AST, checks
  emit.ts resolve.ts                       hand-written emitters (S3, IAM, Lambda, DynamoDB) and REF:/GETATT: resolution
  mapping/                                 table-driven resource mapping: one engine, one table per area
  errors.ts i18n.ts                        message codes (CBF-nnnn-S/W) and the Japanese to English layer
  compile.ts cli.ts deploy.ts report.ts    pipeline, CLI, ChangeSet deployer, 132-column report
tests/                unit, golden (tests/golden/<case>/input.cbl + expected.json), schema snapshots (tests/schemas)
examples/             deployable programs. three-tier, edge, classic and smoke-s3 are hand-kept; the rest come from scripts/gen-examples.py
verify/samples/       original syntax samples checked with GnuCOBOL
web/                  browser demo (editor, line printer); web/dist is generated and ignored
scripts/              example generator, official-schema extractor
docs/                 GUIDE.md and REFERENCE.md (English, for users), DESIGN.md (Japanese design notes), DEMO_SCRIPT.md
```

docs/REFERENCE.md is generated from src/mapping: never edit it by hand, run `npm run docs:reference`. tests/guide.test.ts compiles every program in docs/GUIDE.md.

README.md is the source of truth for the README. `README_ja.md` must match it in structure and content; a hook keeps them in sync.
