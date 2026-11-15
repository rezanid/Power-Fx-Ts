# ADR 0023: Scalar Round, RoundDown and RoundUp

Status: **accepted and implemented; independent review pending**.
Baseline: `c32a6ebe56369867f89eb7613fb72b542289af92` (merged PR #27).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Decision

Implement complete scalar Round(value, digits), RoundDown(value, digits) and RoundUp(value, digits).
All require exactly two arguments. Reuse the scalar-math signature/builtin path and scoped diagnostic
recovery. No new bound node or generic overload framework is needed.

- Operand accepts Number/Float, Decimal, Text, Boolean and Blank. Float/Decimal operands retain
  their kind in either profile; Text/Boolean/Blank use the profile default. Precision always
  explicitly coerces to Float and never selects result kind.
- Reuse existing en-US implicit coercions: Blank/empty Text to zero, Boolean to 0/1, numeric Text
  to the target numeric kind, invalid Text to InvalidArgument. Typed runtime Blank also becomes zero.
- Evaluate operand then precision once each, including after an Error and before any shortcut.
  Ordered combined Errors retain duplicates. Precision Errors are not hidden by a Blank operand.
- Preserve arity/type diagnostics, recovered numeric-call types and invalid-literal cascades.
  Valid table overloads in either argument remain unsupported, not invalid scalar calls.
- Results and Error graphs are frozen; existing per-node budget/cancellation checks apply to
  the call and both evaluated arguments/coercions. Numeric work has bounded scale/exponent sizes.

## Float behavior

Round is nearest with midpoints away from zero, RoundDown is toward zero, RoundUp is away from
zero. Float behavior is the pinned algorithm, not mathematically idealized decimal rounding.
For normalized precision p, use the reference power-of-ten value m, sign s and magnitude n:

- Round: s * floor((n + 1/(2*m) + 1/(m*1e12)) * m) / m.
- RoundDown: existing backend.trunc, s * floor(n*m) / m.
- RoundUp: s * ceil(n*m) / m.

Keep addition and scaling order and the Round epsilon. Powers are decimal exponent constants parsed
to Float, as in Trunc; JS exponentiation can differ by an ulp. The original operand is returned if
p is outside -15..15 or its magnitude exceeds 1e20. Do not extend precision or correct binary
artifacts: RoundDown(Float("0.29"),2) is 0.28; Round(Float("1.4499999999999997"),1) is 1.5.
Ordinary -0 inputs become +0, negative results rounded to zero retain -0, and shortcuts preserve
the input's zero sign. Nonfinite precision/operands fail with Numeric rather than a successful value;
strict nonfinite host validation remains unchanged.

Both pinned RoundFloat and RoundDecimal explicitly clamp coerced Float precision before the Int32
cast. Reuse truncatePrecision: reject nonfinite input, truncate toward zero, saturate to Int32.
No bitwise wrapping. Decimal precision conversion precedes truncation, so 1.9999999999999998 can
become Float 2. This is not table selection's unchecked-cast architecture boundary. Probes executed
on .NET 10.0.14/macOS Arm64, not every .NET/runtime/architecture.

## Exact Decimal behavior

Decimal operands stay opaque BigInt mantissa/scale values with the existing 96-bit magnitude and
0..28 scale limits; no operand goes through JS Number. Precision below -28 returns zero for all
three functions, including RoundUp; above 28 returns the operand unchanged.

Round with nonnegative precision uses exact integer midpoint comparison, away from zero, and
existing representability fitting. For negative precision, first divide by the exact power of ten
using existing Decimal division, then round at precision zero and multiply back. RoundUp uses the
reference's intermediate nearest rounding plus a one-unit correction for nonnegative precision;
negative precision first performs Decimal division, then ceiling of the magnitude and rescaling.
All intermediate operations preserve Decimal representability and surface overflow as Numeric.
Recursion is bounded to one negative-precision-to-zero step; powers are bounded before allocation.

Exact here does not mean infinite precision. Intermediate Decimal rounding and underflow are
observable: Round(Decimal("4.9999999999999999999999999999"),-1) returns 10, while
RoundUp(Decimal("1e-28"),-1) returns zero. A direct arbitrary-precision final quotient/remainder
algorithm would silently differ. Decimal maximum rounded to tens can overflow for Round/RoundUp;
RoundDown still returns the truncated representable value.

RoundDown reuses backend.trunc; **Trunc implementation and semantics are unchanged**. Pinned upstream
also implements Trunc with RoundDown. Both reference fixtures and differential boundary tests
protect the equality, including signed zero, extrema, scale limits and large coerced precision.
Decimal zero/trailing-zero scale uses the existing normalized value/serialization semantics, not
raw .NET Decimal bit-pattern parity.

## Custom backend migration

NumericBackend now additionally requires:

```ts
round(value: NumericValue, digits: number): NumericResult;
roundUp(value: NumericValue, digits: number): NumericResult;
```

digits is the explicitly coerced Float precision, not integer-normalized; each backend owns the
clamping and numeric semantics above. Implement both methods using your own opaque representation,
return immutable payloads, and return Numeric for numeric failures. Decimal implementations must
preserve intermediate Decimal representability without converting the operand through Float.
RoundDown continues calling your existing trunc method, also used by Trunc.

The evaluator does not inspect opaque operands. Only the Float precision backend's toNumber is
called. Tests use private WeakMap tokens to verify method dispatch and raw precision delivery,
assert backend failures surface, and disable Decimal toNumber while evaluating exact operands
including intermediate-division cases. Existing backend identity checks are unchanged.

## Exclusions and evidence

Table/untyped overloads, other math functions, new types, localization/default-culture changes,
numeric-default changes and unrelated refactoring remain excluded. No new deliberate deviation
is introduced. No subsequent milestone is authorized.

Reference probes were committed before implementation in `a7d6a28`.
Sources, exact runtime and regeneration: [scalar-rounding-probes](../research/scalar-rounding-probes/README.md).
Both-profile compatibility transitions: [scalar-rounding-before-after.md](../research/scalar-rounding-before-after.md).
