# ADR 0002: Language version, compatibility profiles and numeric representation

Status: Accepted (9 October 2026)

## Context

The upstream corpus runs under several profiles. Power Fx 1.0 (`PowerFxV1`) makes `Number`
Decimal-backed (`disable:NumberIsFloat`) with a separate `Float` type; older behavior uses IEEE
doubles (`NumberIsFloat`) and a set of feature flags. Many expected results (e.g. `0.1+0.2`,
17+ digit literals, `1E-06` formatting) depend on this.

## Decisions

1. **Power Fx 1.0 semantics only.** The `PowerFxV1` feature set is always on. We do not implement
   pre-1.0 behavior, feature-flag permutations, the `*_V1Compat*` test files, or the legacy
   `legacy-float` profile. Anything unsupported is listed as an explicit deviation.
2. **Profiles:** `v1-decimal` is the long-term primary profile; `v1-float` is the interim target.
   Reports always name upstream commit, profile, number mode, culture and time zone.
3. **`NumericBackend` abstraction.** Public value and type APIs never expose raw `number` for Power Fx
   numbers. The evaluator is written against the backend interface.
4. **Phasing:** Phase 1 implements the float backend and runs `v1-float`. Phase 2 adds the decimal
   backend and the `Decimal`/`Float` type distinction, then `v1-decimal` becomes the release gate.

## Consequences

- Smaller first slice, and no legacy profile matrix in the engine or reports.
- `v1-float` results for `Number` may differ from `v1-decimal` until Phase 2; those cases are
  tracked as known deviations, not hidden.
- Decimal library choice: in-house BigInt-scaled decimal, opt-in via `numberMode: "decimal"`; see
  ADR 0009 (the default remains float pending a maintainer decision).

## Open questions

Float formatting parity with .NET (`1E-06`, `NE+N`); culture and time-zone support (`Intl` vs. data bundle).
