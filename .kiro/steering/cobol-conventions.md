---
inclusion: fileMatch
fileMatchPattern: ["**/*.cbl", "scripts/cobgen.py", "scripts/gen-examples.py"]
---

# Writing COBOL for cobolform

## Fixed format (exact)

- Columns 1-6 sequence number, column 7 indicator (`*` comment, `-` continuation, `D` debug), column 8 onward code.
- Area A starts at column 8 (divisions, sections, paragraphs, `FD`, `01`). Area B starts at column 12 (statements, sub-items).
- Nothing past column 72 is read. A line over 80 columns is an error. Tabs are forbidden. Reserved words and data names are upper case.

## Long string literals (a common trap)

A `VALUE` that does not fit must be split with a continuation line. The first line must run to column 72 **exactly**; the
continuation starts with `-` in column 7 and a quote in column 12. If the split leaves the closing quote at column 73 or beyond, it
is silently lost. Do not hand-split: use `scripts/cobgen.py`, which pads the position until the tail is long enough.

## Naming

- Data names are upper case and hyphenated, at most 30 characters, and must not be COBOL reserved words (`STATUS`, `TIMEOUT`, `ACTION`,
  `AUTHOR`, `NAME` are reserved). A hyphenated, prefixed name (`FN-TIMEOUT-SEC`) avoids the problem. `cobc --list-reserved` is the reference.
- A `01` group becomes the logical ID in PascalCase (`LOGS-BUCKET` is `LogsBucket`). Give a resource a name that does not
  collide with a field name used by the mapping table.
- References: `"REF:NAME"`, `"GETATT:NAME.ATTR"`, same file only. In IAM policy `Resource` items `REF:` resolves to an ARN.
- A comma-separated value is a list (`"REF:SUBNET-A,REF:SUBNET-B"`). `SSM:` and `SECRET:` prefixes become dynamic references.

## Tables

Lists of objects (security group rules, task environment variables, CLB listeners) are `OCCURS` groups whose values are set with
`MOVE` in the `PROCEDURE DIVISION`. A `MOVE` target must be unique in the file, so prefix the item names per resource.

## Every program

Has `IDENTIFICATION DIVISION`, a `PROGRAM-ID` (the stack name), an `OBJECT-COMPUTER AWS-<REGION>`, and ends with `CALL "DEPLOY"` then `STOP RUN`.
A missing `STOP RUN` is a warning ("JOB DID NOT TERMINATE").
