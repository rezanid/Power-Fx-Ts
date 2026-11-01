# DropColumns reference probes

These probes were generated from the executable Microsoft Power Fx reference **before the
TypeScript implementation**. Upstream is pinned at
`df4ceba5e08220db670c25afead342ce699c50b5`; the probes use `Features.PowerFxV1`, en-US and UTC.

The relevant pinned sources are:

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/DropColumns.cs`
- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/ShowDropColumnsBase.cs`
- `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`
  (`TryGetColumnLogicalName`)
- `src/libraries/Microsoft.PowerFx.Core/Public/Config/Features.cs`
  (`SupportColumnNamesAsIdentifiers`)
- `src/libraries/Microsoft.PowerFx.Core/Utils/DName.cs`
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/Library.cs`
  (standard Blank/Error handling)
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTable.cs`
  (record and table projection)
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/FeaturesTest.cs`
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/DropColumns_SupportColumnNamesAsIdentifiers.txt`

In PowerFxV1 the column arguments are identifier syntax, including escaped identifiers such as
`'First Name'`; text literals and arbitrary expressions are rejected. The identifiers name columns,
not variables to evaluate. Name lookup is case-sensitive. Missing and repeated names are diagnosed
against the progressively reduced schema. Record/table sources retain their shape; dropping all
fields yields an empty record schema while preserving every table row. Typed top-level Blank and
Error values propagate; Blank and Error rows are preserved during projection.

`packages/engine/test/fixtures/dropcolumns-probe.expressions.txt` records the probe inputs. The
captured float and decimal outputs are beside it. Regenerate them from the repository root with the
reference checkout at the pinned commit:

```sh
dotnet run --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe float packages/engine/test/fixtures/dropcolumns-probe.expressions.txt > packages/engine/test/fixtures/dropcolumns-probe.float.tsv
dotnet run --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe decimal packages/engine/test/fixtures/dropcolumns-probe.expressions.txt > packages/engine/test/fixtures/dropcolumns-probe.decimal.tsv
```

The expressions cover records, tables, one-column tables, empty schemas, order and retained values,
escaped identifiers, a same-named `With` variable, case sensitivity, missing and duplicate names,
invalid argument forms, arity/source diagnostics, top-level Blank/Error, and Blank/Error rows.
Evaluation-budget and cancellation behavior is tested in TypeScript because those are evaluator
controls rather than Power Fx formula results.
