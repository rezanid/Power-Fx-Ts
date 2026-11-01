# RenameColumns reference probes

These probes were generated before the TypeScript implementation from Microsoft Power Fx commit
`df4ceba5e08220db670c25afead342ce699c50b5`, with `Features.PowerFxV1`, en-US and UTC. The pinned
checkout is `upstream/Power-Fx`.

Relevant upstream sources:

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/RenameColumns.cs`
- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/ShowDropColumnsBase.cs`
- `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`
  (`TryGetColumnLogicalName`)
- `src/libraries/Microsoft.PowerFx.Core/Public/Config/Features.cs`
  (`SupportColumnNamesAsIdentifiers`)
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTable.cs`
  (`RenameColumns`, `LazyRenameColumnsAsync`, `RenameColumnsRecord`)
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/RenameColumns_SupportColumnNamesAsIdentifiers.txt`
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/RenameColumns_SupportColumnNamesAsIdentifiersDisabled.txt`

The standard probe fixture records validity, result schema order, direct runtime record-field order,
`ToExpression()` serialization, diagnostics with severity/span, and runtime exceptions as distinct
columns. Its `{z:3,a:1,m:2}` source deliberately uses noncanonical source order. The reference reports
`a,m,z` for the source, `a,b,m` after renaming `z` to `b`, and `m,x,y` after renaming `a` to `x`
and `z` to `y`; the schema, runtime enumeration and serialization each independently show those
orders. Pair arguments resolve against the original source schema, so multiple pairs are simultaneous,
not chained. A nested call can rename the result of an outer rename.

PowerFxV1 bare and escaped identifiers are syntax-only names in both old- and new-name positions.
Text literals and other expressions are not identifiers. Names are case-sensitive; renaming `a` to
`A` is valid. An escaped name such as `'First Name'` can be renamed to `'Last Name'`. Missing old
names, existing destination collisions, duplicate destinations and repeated old names are invalid.
Renaming a field to itself is a valid no-op. Blank and Error sources propagate; Blank/Error table rows
and errors in retained fields survive; empty tables keep the renamed schema.

## Accepted narrow deviation

The pinned reference checks both expressions below as successful, but its interpreter throws
`An item with the same key has already been added. Key: a` while building its rename dictionary:

```powerfx
RenameColumns({a:1,b:2}, a, a, a, x)
RenameColumns({a:1,b:2}, a, a, a, a)
```

These observations are preserved in `renamecolumns-deviation.*.tsv` and are **not** treated as
reference parity. The approved TypeScript behavior rejects any repeated old name, including after a
no-op pair, with the repeated-source diagnostic. Tests separately cover a single no-op, repeated
no-op and no-op-then-rename. Do not weaken compatibility verdicts to hide this intentional edge
deviation.

Input files and generated float/decimal output TSVs are under
`packages/engine/test/fixtures/renamecolumns-*.{expressions.txt,tsv}`. The `renamecolumns-probe` TSVs
contain separate field-order and runtime-exception observations; `renamecolumns-replay` TSVs use the
ordinary compatibility probe shape. Regenerate from the repository root after confirming
`upstream/Power-Fx` is at the pinned commit. Build first so build logs cannot contaminate redirected
TSV output:

```sh
dotnet build tools/reference-harness -p:EnableSourceControlManagerQueries=false
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe float packages/engine/test/fixtures/renamecolumns-probe.expressions.txt > packages/engine/test/fixtures/renamecolumns-probe.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe decimal packages/engine/test/fixtures/renamecolumns-probe.expressions.txt > packages/engine/test/fixtures/renamecolumns-probe.decimal.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe float packages/engine/test/fixtures/renamecolumns-order.expressions.txt > packages/engine/test/fixtures/renamecolumns-order.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe decimal packages/engine/test/fixtures/renamecolumns-order.expressions.txt > packages/engine/test/fixtures/renamecolumns-order.decimal.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe float packages/engine/test/fixtures/renamecolumns-probe.expressions.txt > packages/engine/test/fixtures/renamecolumns-replay.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe decimal packages/engine/test/fixtures/renamecolumns-probe.expressions.txt > packages/engine/test/fixtures/renamecolumns-replay.decimal.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe float packages/engine/test/fixtures/renamecolumns-deviation.expressions.txt > packages/engine/test/fixtures/renamecolumns-deviation.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe decimal packages/engine/test/fixtures/renamecolumns-deviation.expressions.txt > packages/engine/test/fixtures/renamecolumns-deviation.decimal.tsv
```
