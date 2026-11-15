# Scalar Round / RoundDown / RoundUp reference evidence

Baseline: `c32a6ebe56369867f89eb7613fb72b542289af92` (merged PR #27).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`.
These inputs and generated outputs are committed before implementation.

## Sources and environment

Pinned `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/Round.cs`, `MathFunction.cs`;
`src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`;
`src/libraries/Microsoft.PowerFx.Interpreter/Functions/Library.cs`, `LibraryMath.cs`
(`RoundFloat`, `RoundDecimal`, `RoundDown`, `RoundUp`).
Corpus: `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/Round.txt`,
`RoundDown.txt`, `RoundUp.txt`, `DecimalMathFuncs*.txt`; table corpus was inspected only
to establish excluded overloads.

PowerFxV1, en-US, UTC, both numeric profiles. SDK 10.0.403, Microsoft.NETCore.App 10.0.14,
macOS 27.2.0 Arm64; the net8.0 harness rolls forward to the installed runtime.
No other runtime/architecture execution is claimed.

## Boundaries

Both numeric kernels explicitly clamp coerced Float precision before the Int32 cast.
This is not the unchecked-cast portability boundary in table selection.
Float uses the pinned epsilon and operation order, not an idealized midpoint algorithm;
precision outside -15..15 or magnitude above 1e20 returns the input unchanged.
Signed zero is observed with Text coercion, independently of numeric equality.

Decimal operands are never converted through Float. However, intermediate Decimal division
is representability-limited: Round(Decimal("4.9999999999999999999999999999"),-1)
returns 10, and RoundUp(Decimal("1e-28"),-1) returns zero. Negative precision must
preserve intermediate rounding/underflow, not apply idealized arbitrary-precision rounding.
Overflow is a Numeric Error. Below -28 all three return zero; above 28 they return the input.
Paired RoundDown/Trunc probes protect the existing backend operation and Trunc behavior.

## Regeneration

```sh
git -C upstream/Power-Fx rev-parse HEAD
dotnet build tools/reference-harness -p:EnableSourceControlManagerQueries=false
dotnet run --no-build --project tools/reference-harness -- probe float packages/engine/test/fixtures/scalar-rounding.expressions.txt > packages/engine/test/fixtures/scalar-rounding.float.tsv
dotnet run --no-build --project tools/reference-harness -- probe decimal packages/engine/test/fixtures/scalar-rounding.expressions.txt > packages/engine/test/fixtures/scalar-rounding.decimal.tsv
```

Required-pass fixtures exclude table overloads. Separate tests must preserve their unsupported
classification. Diagnostics retain the upstream numeric-call type recovery behavior.
