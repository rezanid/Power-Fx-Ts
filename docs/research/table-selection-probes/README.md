# FirstN / Last / LastN reference evidence

Approved implementation baseline: `a5be0240fb52dca0a9efdb17a8e507a221bf2f08` (merged AddColumns,
PR #24). Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`.

Status: **boundary research complete; portable count conversion proposed, awaiting approval**.
No FirstN, Last, or LastN TypeScript implementation has been started.

## Reference environment

The checked-in harness targets `net8.0` and specifies `RollForward=Major`. Target framework is not
the executing runtime. These probes executed with:

- SDK **10.0.403**, SDK commit `5a2162bea6`.
- Microsoft.NETCore.App / host **10.0.14**, runtime commit `0427b9abbe`.
- **macOS 27.2.0, Arm64**; RID `osx-arm64`.
- `Features.PowerFxV1`, en-US, UTC; both float and decimal parser/numeric profiles.

Only that runtime/architecture was executed here. No .NET 8/x64 comparison run is claimed.
The direct-cast TSV headers capture framework, runtime version, OS, architecture and profile.

## Sources and interpretation

At the upstream pin:

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/FirstLast.cs`
- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/FirstLastN.cs`: the count parameter is
  `DType.Number` (Float), including in decimal mode.
- `src/libraries/Microsoft.PowerFx.Core/Public/Config/Features.cs`: PowerFxV1 enables
  `FirstLastNRequiresSecondArguments`; omitted counts are invalid, not defaulted.
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/Library.cs`: count Blank becomes Float
  zero; argument Errors are handled before selection.
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTable.cs`: FirstN uses
  `Take((int)count)`; LastN traverses all rows, then uses `(int)count` for Skip/Take.
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/FirstLastN.txt`,
  `FirstLastN_V1Compat.txt`, `FirstLastN_RequiredSecondArgument.txt`,
  `FirstLastN_RequiredSecondArgumentDisabled.txt`, `FirstLast.txt`, and `FirstLast_V1Compat.txt`.

Microsoft documents the runtime change separately:
[Floating point-to-integer conversions are saturating](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer).
That document describes the .NET 9 change on x86/x64 from overflow yielding Int32.MinValue to
saturation, and explicitly notes differing behavior on other architectures such as Arm64.

**Stable supported semantics:** source-then-count evaluation, count coercion to Float, truncation
toward zero for representable integer results, nonpositive selections being empty, and counts
larger than the source length returning all rows when the converted integer is positive.
Decimal values pass through the pinned Decimal-to-Float conversion before integer truncation.

**Runtime-dependent boundary:** the unchecked C# conversion of a Float outside Int32's range.
Pinning Power Fx source alone does not pin this result. A very large positive count returns all
rows on the measured runtime, but can become Int32.MinValue and return no rows under documented
older x86/x64 behavior. Negative overflow produces an empty selection under both behaviors.
Do not label these overflow results as universal language parity.

## Recorded observations

The formula TSVs preserve complete types and results; the cast TSVs separately record the
coerced Float and actual `unchecked((int)value)` result. For source `[1,2,3]`, both profiles agree
on selection; only the row numeric types differ:

| Input count                           | Observed Float        | Observed Int32 | FirstN / LastN selection |
| ------------------------------------- | --------------------- | -------------: | ------------------------ |
| `2147483646.9`                        | `2147483646.9`        |     2147483646 | All three rows           |
| `2147483647.9`                        | `2147483647.9`        |     2147483647 | All three rows           |
| `2147483648`                          | `2147483648`          |     2147483647 | All three rows           |
| `-2147483647.9`                       | `-2147483647.9`       |    -2147483647 | Empty                    |
| `-2147483648.9`, `-2147483649`        | As recorded in TSV    |    -2147483648 | Empty                    |
| `Float("1e20")`, maximum finite Float | As recorded in TSV    |     2147483647 | All three rows           |
| Corresponding negative finite Floats  | As recorded in TSV    |    -2147483648 | Empty                    |
| `Decimal("1.9999999999999997")`       | `1.9999999999999996`  |              1 | First row / last row     |
| `Decimal("1.9999999999999998")`       | `2`                   |              2 | First two / last two     |
| `Decimal("2147483647.9999997")`       | `2147483647.9999995`  |     2147483647 | All three rows           |
| `Decimal("2147483647.9999998")`       | `2147483648`          |     2147483647 | All three rows           |
| `Decimal("-2147483648.0000002")`      | `-2147483648`         |    -2147483648 | Empty                    |
| `Decimal("-2147483648.0000003")`      | `-2147483648.0000005` |    -2147483648 | Empty                    |

The inputs also cover exact Int32 extrema, adjacent positive/negative fractions, both signs of the
maximum Decimal, and both signs of the maximum finite Float. Decimal-to-Float must not be replaced
with `Number(decimalText)`: the existing Decimal backend already implements the reference conversion
algorithm, including the rounding shown above. The existing engine agrees on those conversion
examples; no Decimal-backend prerequisite was found.

## Proposed TypeScript rule (not yet accepted)

After existing explicit Float coercion and argument-error handling, for a finite count `value`:

```ts
const int32Count = Math.max(-2147483648, Math.min(2147483647, Math.trunc(value)));
const selectedCount = Math.max(0, int32Count);
```

Clamp selection to available rows only after this conversion. Do not use JavaScript bitwise
operators or modulo/wrapping conversion. Nonfinite host values remain invalid at the existing
host boundary; numeric/coercion Errors propagate rather than being converted to a count.

This rule matches all measured reference results, but deliberately chooses deterministic,
saturating overflow behavior rather than reproducing every older runtime's cast behavior.
**Owner approval is required for that portability decision before implementing it.** If approved,
record it in the milestone ADR as a compatibility boundary; do not claim parity with older
x86/x64 overflow behavior or weaken corpus verdicts for it.

LastN traversal will check cancellation and charge the budget for every source row, without
copying the entire table just to perform the checks. Selection remains separate from source
evaluation; no unselected row expression is reevaluated.

## Regeneration

From the repository root, with the exact upstream pin checked out:

```sh
git -C upstream/Power-Fx rev-parse HEAD
dotnet --info
dotnet build tools/reference-harness -p:EnableSourceControlManagerQueries=false
dotnet run --no-build --project tools/reference-harness -- probe float packages/engine/test/fixtures/table-selection-boundary.expressions.txt > packages/engine/test/fixtures/table-selection-boundary.float.tsv
dotnet run --no-build --project tools/reference-harness -- probe decimal packages/engine/test/fixtures/table-selection-boundary.expressions.txt > packages/engine/test/fixtures/table-selection-boundary.decimal.tsv
dotnet run --no-build --project tools/reference-harness -- count-cast-probe float packages/engine/test/fixtures/table-selection-counts.expressions.txt > packages/engine/test/fixtures/table-selection-casts.float.tsv
dotnet run --no-build --project tools/reference-harness -- count-cast-probe decimal packages/engine/test/fixtures/table-selection-counts.expressions.txt > packages/engine/test/fixtures/table-selection-casts.decimal.tsv
```

Build before redirecting output. Review regenerated overflow results with their runtime provenance;
do not overwrite these observations as if a runtime change were a Power Fx source change.
