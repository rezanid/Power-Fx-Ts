# Milestone 0017: `DropColumns` for supported Record/Table values

Status: **reviewed and merged in PR #21**. Baseline:
`fc59733cd2e562a1c93b673eed46fd4449a66ba8`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. Merge commit:
`e2d4624f0ab599745c23a0548622811cb8e59748`. See ADR 0017 for the accepted decision.

## Included

- Bind `DropColumns(source, name, ...)` with a Record or Table source and at least one column name.
- Treat PowerFxV1 bare and escaped identifiers as column names, never evaluated expressions or
  schema/scope variable references.
- Remove fields sequentially from the returned static schema; report missing and duplicate names,
  invalid name syntax, wrong source types and arity errors.
- Project records and table rows while retaining values/order; preserve top-level Blank/Error and
  Blank/Error table rows; keep returned values recursively immutable.
- Check cancellation and charge the evaluation budget for each visited table row.

## Excluded

`ShowColumns`, `RenameColumns`, `AddColumns`, dynamic/untyped schemas, data-source host metadata,
delegation, and unrelated table-function refactoring.

## Verification

- Reference probes generated before implementation and replayed in float and decimal modes.
- Focused tests for binding, output types, diagnostics, variable-name collisions, row ordering,
  retained nested values, Blank/Error preservation, recursive freezing, budget and cancellation.
- Full build/test/lint/format checks and both corpus compatibility profiles; compare per-case verdicts
  against this baseline and require zero pass-to-non-pass regressions.
- Update README, coverage inventory, handoff and per-case evidence; open a draft PR and wait for CI
  on its final commit. Do not merge or begin another milestone.
