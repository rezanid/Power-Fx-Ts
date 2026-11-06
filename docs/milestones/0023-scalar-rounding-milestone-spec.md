# Milestone 0023: Scalar Round, RoundDown and RoundUp

Status: **implemented; independent review pending**.
Baseline: `c32a6ebe56369867f89eb7613fb72b542289af92` (merged PR #27).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`. See ADR 0023.

## Included

- Full scalar signatures, exactly two arguments; explicit numeric operand/Float precision
  coercions, profile-aware result kinds, typed Blank-to-zero and ordered eager combined Errors.
- Pinned Float epsilon and operation order, scaling artifacts, signed zero and unchanged-value
  shortcuts; explicit pre-cast Int32 precision saturation verified from source and probes.
- Exact Decimal operands with intermediate rounding/underflow, bounded scale and Numeric overflow.
- Existing backend.trunc reused for RoundDown without changing Trunc; paired differential regression
  coverage. New round/roundUp backend operations and custom-backend migration documentation.
- Recursive immutability, existing per-node budgets/cancellation, diagnostics and valid table
  overloads explicitly classified unsupported.

## Excluded

Table/untyped overloads, other math functions, new types, localization/default-culture changes,
numeric-default changes and unrelated refactoring.

## Verification and delivery

- Commit reference inputs/results before implementation; record exact runtime and upstream pin.
- Probe midpoint/scaling neighbors, signed zero, positive/negative/fractional precision, signed
  Int32 boundaries, Decimal-to-Float precision conversion, intermediate Decimal division and
  representability overflow. Preserve Float/Decimal differences rather than approximating them.
- Replay both profile fixtures; verify exact operands with Decimal-toNumber disabled, custom opaque
  backends and failures, RoundDown/Trunc equivalence, frozen results, eager budgets/cancellation.
- Run build, all tests, lint, formatting and both compatibility profiles. Require identical
  baseline/candidate case sets, zero pass-to-non-pass regressions and unchanged verdict rules.
- Update ADR/spec, provenance, evidence, handoff and existing coverage statistics. Open a draft PR,
  verify CI on the final pushed head, and stop for independent review. Do not merge or begin another
  milestone.
