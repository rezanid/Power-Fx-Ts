# Milestone 0022: Scalar Abs, Int and Trunc

Status: **implemented; independent review pending**.
Baseline: `14f9f31ef03c2bf2c80948a8a7fc889a43be2c94`.
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`. See ADR 0022.

## Included

- Complete scalar Abs(value), Int(value), Trunc(value[, digits]); default precision zero.
- Profile-aware numeric result types; explicit scalar numeric coercions and Float precision.
- Exact Decimal operands, Float scaling/shortcut behavior, signed zero, finite extrema and
  precision saturation at signed Int32 boundaries.
- Typed/untyped Blank to zero, ordered eager errors, diagnostics and valid table overloads
  classified unsupported.
- Backend-level abs/floor/trunc operations, custom-backend migration documentation and opaque-value
  regression coverage; frozen results and existing per-node budgets/cancellation.

## Excluded

Table/untyped overloads, new types, other math functions, localization changes, numeric-default
changes and unrelated refactoring.

## Verification and delivery

- Commit reference probes before implementation, covering signed zero, Decimal extrema, Float
  scaling boundaries, precision coercion and signed Int32/large finite precision boundaries.
- Record the exact runtime. Distinguish Trunc's explicit pre-cast clamp from table selection's
  unchecked runtime-dependent overflow; do not claim universal .NET parity.
- Replay probes in both profiles; assert exact Decimal behavior without operand conversion to
  Number, custom-backend routing/failures, frozen results, budgets and cancellation.
- Run build, all tests, lint, formatting and both compatibility profiles. Compare every applicable
  case against the merged baseline, requiring zero pass-to-non-pass regressions without weakening
  verdict rules.
- Update provenance, coverage statistics, handoff and evidence. Open a draft PR, verify CI at its
  final head, and stop for independent review. Do not merge or start another milestone.
