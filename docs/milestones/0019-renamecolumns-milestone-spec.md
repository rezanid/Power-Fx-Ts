# Milestone 0019: `RenameColumns` for statically supported Record/Table values

Status: **implemented, independently reviewed, and merged in PR #23**. Baseline:
`fbbb6c786aba882479806c2e0c36150cf451b156`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. See ADR 0019.

## Included

- Bind `RenameColumns(source, oldName, newName, ...)` for static Record and Table sources.
- Treat PowerFxV1 bare and escaped identifiers in both name positions as syntax-only identifiers.
- Resolve all old names against the original schema; apply distinct source/destination pairs
  simultaneously; permit a single no-op; reject missing sources, repeated sources, existing
  destination collisions, repeated destinations, and invalid even arity.
- Return canonical ordinal schema and runtime field order; preserve rows and field values.
- Propagate typed source Blank/Error; preserve Blank/Error table rows and retained field errors.
- Keep projected values recursively immutable and check cancellation/charge the budget per table row.
- Deliberately reject repeated old names after no-op pairs, despite the pinned reference accepting
  `Check` and then throwing during evaluation; keep those cases separate from parity evidence.

## Excluded

`AddColumns`, dynamic/untyped schemas, display-name/data-source metadata, delegation, and unrelated
table-function refactoring.

## Verification

- Generate float/decimal executable-reference probes before implementation. Separately capture type
  field enumeration, runtime field enumeration, `ToExpression()` ordering, diagnostics, and runtime
  exceptions using source fields written in nonalphabetical order.
- Replay reference behavior in both numeric profiles. Explicitly test valid no-op, repeated no-ops,
  no-op-then-rename, diagnostics, variable collisions, escaped/case-sensitive names, Blank/Error
  behavior, empty tables, immutability, cancellation and per-row budget.
- Run build, all tests, lint, formatting and both compatibility profiles. Compare each case against
  baseline `fbbb6c786aba882479806c2e0c36150cf451b156`; require zero pass-to-non-pass regressions.
- Update README, coverage inventory, provenance, handoff and per-case evidence; open a draft PR and
  wait for CI on its final commit. Do not merge or begin another milestone.
