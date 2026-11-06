# Scalar Abs / Int / Trunc reference evidence

Baseline: `14f9f31ef03c2bf2c80948a8a7fc889a43be2c94` (merged PR #26).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`.
These inputs and generated outputs are committed before implementation.

## Sources

Pinned upstream `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/Abs.cs`, `Int.cs`,
`Trunc.cs`, `MathFunction.cs`; `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`
(`DetermineNumericFunctionReturnType`); interpreter `Functions/Library.cs` and `LibraryMath.cs`.
Corpus: `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/Abs.txt`, `Int.txt`,
`Trunc.txt` and `DecimalMathFuncs*.txt`.

The harness uses PowerFxV1, en-US, UTC, with both numeric profiles. Execution environment:
SDK 10.0.403; Microsoft.NETCore.App 10.0.14; macOS 27.2.0 Arm64. The net8.0 project rolls forward
to the installed runtime. No other runtime/architecture execution is claimed.

## Precision conversion and numeric boundaries

Trunc precision always coerces to Float, including Decimal precision inputs, then truncates toward
zero and saturates to Int32. Unlike the upstream table-selection unchecked cast, `RoundFloat` and
`RoundDecimal` **explicitly clamp before casting**. Thus out-of-range finite precision does not
depend on the older unchecked-cast behavior described in ADR 0021. The mathematical conversion
matches our existing deterministic saturation rule, but the implementations need not share code.
Do not infer universal .NET parity from the single measured environment.

Float precision outside -15..15, or operand magnitude greater than 1e20, returns the original
operand. Decimal precision below -28 returns zero, above 28 returns the operand. Fractional
precision is truncated only after Float coercion: Decimal 1.9999999999999998 becomes Float 2,
while 1.9999999999999997 becomes 1.9999999999999996.

Float scaling is deliberately not decimal arithmetic: Trunc(Float("0.29"),2) is 0.28;
the Decimal version is exactly 0.29. Signed-zero observations use Text coercion so they are not
hidden by numeric equality: Abs(-0) gives +0, Int(-0) retains -0, ordinary Trunc(-0) gives +0,
and truncating a negative fraction to zero gives -0. Float shortcut paths preserve their input.
Decimal operands remain exact; no Decimal operand is routed through Float.

## Regeneration

```sh
git -C upstream/Power-Fx rev-parse HEAD
dotnet build tools/reference-harness -p:EnableSourceControlManagerQueries=false
dotnet run --no-build --project tools/reference-harness -- probe float packages/engine/test/fixtures/scalar-math.expressions.txt > packages/engine/test/fixtures/scalar-math.float.tsv
dotnet run --no-build --project tools/reference-harness -- probe decimal packages/engine/test/fixtures/scalar-math.expressions.txt > packages/engine/test/fixtures/scalar-math.decimal.tsv
```

Fixtures include extrema, subnormals, Float scaling/shortcut boundaries, Decimal scale limits,
signed Int32 precision boundaries and rounding before precision truncation, type/coercion behavior,
typed Blank, ordered errors, arity and argument diagnostics. Table overloads are outside the scalar
required-pass fixtures and must remain unsupported in the engine, not silently approximated.
