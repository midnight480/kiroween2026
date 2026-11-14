---
inclusion: always
---

# Technology and commands

- TypeScript on Node.js (>= 20), ES modules. Tests: Vitest. Web bundle: esbuild. Deployment: AWS SDK for JavaScript v3
  (`@aws-sdk/client-cloudformation`) with ChangeSets. Dependencies are pinned to exact versions.
- The compiler core (`card`, `lexer`, `parser`, `semantic`, `emit`, `resolve`, `mapping/*`, `yaml`, `errors`, `i18n`) must stay free of
  Node-only imports, because the same code runs in the browser. Only `cli.ts`, `deploy.ts` and `report.ts` may use Node or the AWS SDK.

## Commands

| Task | Command |
|---|---|
| Typecheck | `npx tsc --noEmit` |
| All tests | `npx vitest --run` |
| Build the CLI | `npm run build` |
| Build the browser demo | `npm run web:build`, then serve `web/` on `127.0.0.1` |
| Regenerate the generated examples | `python3 scripts/gen-examples.py` |
| Regenerate docs/REFERENCE.md | `npm run docs:reference` (the tests fail when it is stale) |
| Refresh the official schema snapshots | `uv run --with cfn-lint==1.60.0 python scripts/extract-schemas.py` |
| Lint a template | `uvx cfn-lint <file>` (exit 4 = warnings only, such as W3010 hard-coded AZs) |
| Check a sample is real COBOL | `cobc -fsyntax-only --fixed <file>` |

Always run the typecheck and the full test suite before presenting a change. The browser demo caches its JavaScript:
hard-reload after rebuilding.
