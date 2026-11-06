# ADR 0022: Scalar Abs, Int and Trunc

Status: **accepted, implemented and merged in PR #27**.
Baseline: `14f9f31ef03c2bf2c80948a8a7fc889a43be2c94` (merged PR #26).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Decision

Implement complete scalar `Abs(value)`, `Int(value)` and `Trunc(value[, digits])` signatures.
Trunc defaults to zero digits. No new bound node or general math/rounding framework is needed.
Shared signatures infer types and explicit coercions; builtin implementations use numeric backend
operations and immutable constructors.

- Abs returns absolute value; Int floors toward negative infinity, not an Int32 operand conversion;
  Trunc rounds toward zero at the specified decimal position.
- First arguments accept existing Number/Float, Decimal, Text, Boolean and Blank scalar values.
  Float operands return Float, Decimal operands return Decimal, regardless of profile.
  Text/Boolean/Blank use the profile's default numeric kind. Trunc's digits always coerce to Float
  and do not determine the result kind.
- Reuse existing en-US implicit numeric parsing: empty Text and Blank become zero, Boolean is 0/1,
  numeric Text converts, invalid/whitespace-only Text produces InvalidArgument.
  Typed runtime Blank also becomes zero even when no identity coercion node was necessary.
- Evaluate supplied arguments once, left-to-right, including after an earlier argument Error.
  Reuse ordered Error combination (extracted from the evaluator without changing existing behavior);
  retain duplicate Errors. Errors in precision win over a zero/Blank operand or a shortcut result.
- Preserve ordinary arity diagnostics, invalid-function/type diagnostics, and out-of-range-literal
  cascades. Table overloads remain explicitly unsupported rather than invalid scalar calls.
- Results and Error graphs are frozen. Every evaluated call/argument/coercion retains ordinary
  cancellation and budget accounting; no data-dependent unbounded loops are introduced.

## Float and Decimal boundaries

Trunc precision coerces to Float, truncates toward zero and saturates to Int32. Both pinned
`RoundFloat` and `RoundDecimal` **explicitly clamp before casting**, unlike table selection's
unchecked cast. This agrees with our deterministic saturation rule, but does not inherit the older
out-of-range unchecked-cast ambiguity. Finite signed Int32 boundaries and very large precisions were
probed in both profiles. Execution was .NET 10.0.14 on macOS Arm64 (SDK 10.0.403); no universal
.NET/runtime/architecture parity is claimed.

Decimal precision converts to Float before truncation: `"1.9999999999999998"` becomes 2,
while `"1.9999999999999997"` becomes 1.9999999999999996 and truncates to 1.
This explicit conversion applies only to precision, never to the Decimal operand.

Float Trunc returns its original operand when integer precision is outside -15..15 or magnitude is
greater than 1e20. Otherwise preserve the pinned scaling algorithm, including binary floating-point
artifacts: Trunc(Float("0.29"),2) is 0.28. Powers of ten use decimal exponent constants parsed to
Float rather than JavaScript exponentiation, whose negative powers can differ from the measured
.NET results.

Decimal operands remain exact BigInt mantissa/scale values. Abs changes magnitude, Int uses integer
division plus a negative-remainder floor correction, and Trunc removes decimal places by integer
division. Negative precision restores the corresponding power of ten after division. Precision
below -28 returns zero; precision at or above the operand scale leaves it unchanged. Exponents are
bounded before allocating powers. The result cannot exceed the input's absolute magnitude, except
Int's floor correction, which remains within the Decimal range. No Decimal operand passes through
JS Number, including at the extrema.

Float signed zero follows the reference: Abs(-0) gives +0, Int(-0) preserves -0, ordinary Trunc(-0)
gives +0, negative fractions truncated to zero give -0, and shortcut paths preserve their input.
Decimal zero stays in the existing normalized representation. Literal/conversion errors and strict
nonfinite host rejection are unchanged; backends reject nonfinite precision with Numeric, not a
valid count or successful fallback.

## Custom backend migration

`NumericBackend` now requires:

```ts
abs(value: NumericValue): NumericResult;
floor(value: NumericValue): NumericResult;
trunc(value: NumericValue, digits: number): NumericResult;
```

Implement these using your own opaque representation and numeric semantics. `digits` is the
coerced Float precision, not yet integer-normalized: reject nonfinite input, truncate toward zero,
clamp to Int32, then apply the backend-specific limits above. Return Numeric on numeric failure.
Do not implement Decimal operations by converting the operand to Float. Return immutable numeric
payloads, and keep backend-instance identity semantics unchanged.

The evaluator/builtins never inspect opaque payloads; only the backend's `toNumber` converts the
Float precision. A regression backend uses object tokens and a private WeakMap; tests assert all
three operations are called, errors surface, and a Decimal backend whose `toNumber` throws still
handles exact Decimal operands. Existing backend identity tests remain in the full suite.

## Exclusions and evidence

Table/untyped overloads, unsupported types, other math functions (including exposing RoundDown),
localization/default-culture changes, numeric-default changes and unrelated refactoring are excluded.
There is no new deliberate semantic deviation.

Pre-implementation probes were committed in `bb8b4fb`; nested diagnostic probes were committed in
`8617cfb` before the binder recovery follow-up. Sources, environment and regeneration:
[`scalar-math-probes/`](../research/scalar-math-probes/README.md).
Both-profile case evidence: [`scalar-math-before-after.md`](../research/scalar-math-before-after.md).
