# Milestone 0018: `ShowColumns` for supported Record/Table values

Status: **implemented; independent review pending**. Baseline:
`e2d4624f0ab599745c23a0548622811cb8e59748`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. See ADR 0018.

## Included

- Bind `ShowColumns(source, name, ...)` for static Record and Table sources, with at least one
  column-name argument.
- Treat PowerFxV1 bare and escaped identifiers as syntax-only column names, never variable
  references or evaluated expressions.
- Select existing fields into the result schema in canonical ordinal field-name order, independent
  of argument order. Preserve source row order and values.
- Report missing names and invalid argument syntax. For duplicates, preserve the upstream warning
  severity while also reporting invalid function arguments and rejecting the call.
- Propagate typed top-level Blank/Error; preserve Blank/Error table rows and retained field errors.
- Preserve recursive immutability and check cancellation/charge the evaluation budget per row.

## Excluded

`RenameColumns`, `AddColumns`, dynamic/untyped schemas, display-name/data-source metadata,
delegation, and unrelated table-function refactoring.

## Verification

- Generate float/decimal executable-reference probes before implementation. Separately record
  `CheckResult.ReturnType` field enumeration, `RecordValue.Fields` runtime enumeration, and
  `FormulaValue.ToExpression()` serialization using source fields written in nonalphabetical order.
- Replay reference behavior and diagnostics in both profiles; explicitly test duplicate warning plus
  invalid-call status, variable-name collisions, order, Blank/Error handling, empty tables,
  immutability, cancellation and per-row budget.
- Run build, all tests, lint, formatting and both compatibility profiles. Compare each case against
  this baseline and require zero pass-to-non-pass regressions.
- Update README, coverage inventory, provenance, handoff and per-case evidence; open a draft PR and
  wait for CI on its final commit. Do not merge or begin another milestone.
