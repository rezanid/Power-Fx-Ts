# AddColumns reference probes

These probes are generated before the TypeScript implementation from Microsoft Power Fx commit
`df4ceba5e08220db670c25afead342ce699c50b5`, with `Features.PowerFxV1`, en-US and UTC. The pinned
checkout is `upstream/Power-Fx`.

Relevant upstream sources and tests:

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/AddColumns.cs`
- `src/libraries/Microsoft.PowerFx.Core/Functions/FunctionScopeInfo.cs`
- `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`
  (`TryGetColumnLogicalName`)
- `src/libraries/Microsoft.PowerFx.Core/Public/Config/Features.cs`
  (`SupportColumnNamesAsIdentifiers`)
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTable.cs`
  (`AddColumns`, `LazyAddColumnsAsync`, `AddColumnsRecordAsync`)
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/AddColumns_SupportColumnNamesAsIdentifiers.txt`
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/AddColumns.txt`

The expressions in `packages/engine/test/fixtures/addcolumns-probe.expressions.txt` deliberately
exercise original-row scope, `ThisRecord`, explicit `As` aliases, outer-variable shadowing, later
expressions that must not see earlier added fields, and continued evaluation after a field-level
error. They also cover empty tables, typed Blank/Error record and table sources, Blank/Error rows,
case-sensitive collisions, repeated additions, escaped names and identifier diagnostics.

The `addcolumns-probe.*.tsv` files separately record binding validity, schema order, direct runtime
field enumeration, serialized output, diagnostic severity/span and runtime exceptions. The
nonalphabetical `{z:3,a:1,m:2}` inputs distinguish the orderings rather than inferring runtime
ordering from serialization alone. The regular `addcolumns-replay.*.tsv` files retain the ordinary
compatibility-probe output shape.

## Supported harness setup and regeneration

The harness targets .NET 8 and is verified with the .NET 10 SDK. Use the .NET 8 SDK or a later SDK
that supports targeting `net8.0`, with a compatible runtime. The pinned upstream checkout must exist
at `upstream/Power-Fx` and be at commit `df4ceba5e08220db670c25afead342ce699c50b5`.

From the repository root, build first so build logs cannot contaminate redirected TSV output:

```sh
dotnet build tools/reference-harness -p:EnableSourceControlManagerQueries=false
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe float packages/engine/test/fixtures/addcolumns-probe.expressions.txt > packages/engine/test/fixtures/addcolumns-probe.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- renamecolumns-probe decimal packages/engine/test/fixtures/addcolumns-probe.expressions.txt > packages/engine/test/fixtures/addcolumns-probe.decimal.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe float packages/engine/test/fixtures/addcolumns-probe.expressions.txt > packages/engine/test/fixtures/addcolumns-replay.float.tsv
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe decimal packages/engine/test/fixtures/addcolumns-probe.expressions.txt > packages/engine/test/fixtures/addcolumns-replay.decimal.tsv
```

The existing ordering-aware `renamecolumns-probe` command is used only as a generic independent
reference observation tool; its output records schema, runtime and serialization separately. It
does not imply that AddColumns uses RenameColumns behavior.

The bare dotted-name probes (`b.d`) intentionally remain invalid: upstream binds that expression
outside the AddColumns row scope, reports the unresolved `b` and dot-on-Error diagnostics, then
reports invalid arguments. The escaped identifier (`'b.d'`) is a valid single column name.
