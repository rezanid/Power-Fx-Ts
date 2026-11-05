# Milestone 0021: FirstN, Last and LastN for statically supported tables

Status: **implemented and merged in PR #25** at
`3f6d86bf3f597a38f190c94518aed69b4e0b2d92`. Baseline:
`a5be0240fb52dca0a9efdb17a8e507a221bf2f08`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. See ADR 0021.

## Included

- Last(table), FirstN(table, count), LastN(table, count), plus bare/typed Blank handling.
- PowerFxV1 arity/type diagnostics and counts coercible to Float in both profiles.
- Owner-approved deterministic count conversion: Float coercion, truncation toward zero, Int32
  saturation, then nonpositive count to zero. Reject nonfinite input/propagate numeric errors.
- Preserve complete source schemas, row order, selected Blank/Error rows and field errors.
- Eager source-then-count evaluation and ordered Error combination, even for Blank/Error sources
  and empty/zero selections. No new row scope and no reevaluation of source row expressions.
- Recursive immutability and safe sharing of source rows.
- Per-node checks plus prefix-row checks for FirstN, all-row traversal for LastN (including zero
  count, without an unnecessary full-table copy), and final-row access for Last.
- Explicitly record runtime-dependent overflow and inherited source runtime field enumeration.

## Excluded

Dynamic/untyped overloads, lazy/paged tables, data sources/delegation, mutation, legacy default-count
profiles, other functions, and unrelated refactoring.

## Verification

- Generate and commit reference probes before implementation. Capture both profiles, exact runtime,
  direct casts, positive/negative Int32 boundaries, very large finite Floats, and Decimal-to-Float
  rounding before truncation. Return for approval if a deterministic portability rule is needed.
- Replay the reference fixtures, including diagnostics, Blank/Error source/rows, count coercions,
  schema retention, and independent schema/runtime/serialized ordering observations.
- Test budgets, cancellation, eager source/count evaluation, immutable result graphs and unchanged
  inputs. Test host nonfinite rejection and nonfinite-backend Numeric errors.
- Run build, all tests, lint, formatting and both compatibility profiles. Compare each case with
  the merged baseline; report fixes and regressions separately and require zero pass-to-non-pass
  regressions.
- Refresh AddColumns' merged status, provenance, coverage inventory, README and handoff. Open a
  draft PR, verify final-head CI, and stop for independent review. Do not merge or start another
  milestone.
