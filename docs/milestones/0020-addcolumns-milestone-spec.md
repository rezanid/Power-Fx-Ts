# Milestone 0020: `AddColumns` for statically supported Record/Table values

Status: **implemented; independent review pending**. Baseline:
`3d26204f5c970141a449cc596cf7969b6a18aaa9`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. See ADR 0020.

## Included

- Bind `AddColumns(source, name, formula, ...)` for statically supported Record and Table values.
- Treat PowerFxV1 bare/escaped identifiers in name positions as syntax-only. Preserve upstream
  diagnostics for invalid literals and bare dotted expressions; escaped dotted names remain valid.
- Bind each addition against the original row scope, honor `ThisRecord` and `As`, preserve outer
  variable shadowing behavior, and ensure later additions cannot read earlier additions.
- Evaluate additions left-to-right for each value row, continuing after a field-level Error.
- Infer added-field types even for empty tables without evaluating addition expressions.
- Propagate typed Blank/Error sources and preserve Blank/Error table rows without evaluating
  additions. Preserve errors in source fields and computed fields.
- Reject existing-name collisions and repeated new names; names are case-sensitive.
- Canonically order output schema, runtime fields, and serialized fields; recursively freeze results.
- Check cancellation and budget per row and before each addition expression.

## Excluded

Dynamic/untyped schemas, data-source metadata/delegation, mutation, other table functions, and
unrelated refactoring.

## Verification

- Generate float/decimal executable-reference probes before implementation. Separately observe
  schema/type order, direct runtime field enumeration, serialized output, diagnostics and runtime
  results using deliberately nonalphabetical source fields.
- Replay the probes and test original-row scope, aliases, shadowing, later additions resolving outer
  variables, Error continuation, empty tables, typed Blank/Error sources, Blank/Error rows,
  collisions, escaped/case-sensitive names, recursive immutability, budgets and cancellation.
- Run build, all tests, lint, formatting and both compatibility profiles. Compare each case against
  baseline `3d26204f5c970141a449cc596cf7969b6a18aaa9`; report fixes and regressions separately and
  require zero pass-to-non-pass regressions.
- Update README, coverage inventory, provenance, handoff and per-case evidence; open a draft PR and
  wait for CI on its final commit. Do not merge or begin another milestone.
