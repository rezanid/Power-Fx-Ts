# ShowColumns reference probes

These probes were generated from the executable Microsoft Power Fx reference **before the TypeScript
implementation**, using pinned upstream `df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`,
en-US and UTC.

The relevant pinned sources are:

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/ShowColumns.cs`
- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/ShowDropColumnsBase.cs`
- `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`
  (`TryGetColumnLogicalName`)
- `src/libraries/Microsoft.PowerFx.Core/Public/Config/Features.cs`
  (`SupportColumnNamesAsIdentifiers`)
- `src/libraries/Microsoft.PowerFx.Core/Types/DType.cs`
  (`ReportNonExistingName`, `TryGetSimilarName`)
- `src/libraries/Microsoft.PowerFx.Core/Public/Values/RecordValue.cs`
  (`Fields`, `ToExpression`)
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTable.cs`
  (`ShowColumns`, `DropColumns`)
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/ShowColumns.txt`
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/ShowColumns_SupportColumnNamesAsIdentifiersDisabled.txt`

The ordinary reference fixtures replay static type, runtime value, and diagnostics. The additional
order fixture uses the harness `showcolumns-probe` command. It independently reads the checked
`ReturnType` field enumeration, the evaluated Record/Table runtime `Fields`, and the serialized
`FormulaValue.ToExpression()` output. It does not derive runtime ordering from serialization.

The source record fields in the order probes are deliberately authored as `z,a,m`. The pinned
reference reports source type and runtime field order `a,m,z`; selecting `z,m` or `m,z` yields
type/runtime order `m,z`, and serialized record output is also `m,z`. Thus requested column order
does not determine output order. For a duplicate name, `CheckResult.Errors` contains a `Warning` on
the repeated identifier and a `Severe` invalid-function-arguments error; the check remains invalid.

Probe input files are `packages/engine/test/fixtures/showcolumns-*.expressions.txt`. Regenerate all
fixtures from the repository root with the pinned upstream checkout. Build once before redirecting
command output so build logs cannot contaminate the TSV files:

```sh
dotnet build tools/reference-harness -p:EnableSourceControlManagerQueries=false
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe float packages/engine/test/fixtures/showcolumns-probe.expressions.txt > packages/engine/test/fixtures/showcolumns-probe.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe decimal packages/engine/test/fixtures/showcolumns-probe.expressions.txt > packages/engine/test/fixtures/showcolumns-probe.decimal.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- showcolumns-probe float packages/engine/test/fixtures/showcolumns-order.expressions.txt > packages/engine/test/fixtures/showcolumns-order.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- showcolumns-probe decimal packages/engine/test/fixtures/showcolumns-order.expressions.txt > packages/engine/test/fixtures/showcolumns-order.decimal.tsv
```

The output includes record/table projection, order, duplicate and missing identifiers, escaped and
same-named local identifiers, typed Blank/Error sources, Blank/Error rows, retained field errors,
empty tables, invalid argument forms, and arity diagnostics. Budget and cancellation are evaluator
controls, so they are tested in TypeScript.
