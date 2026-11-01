# Scalar text reference probes

These are reference-harness probes for the scalar `Len`, `Lower`, and `Upper` milestone. The
expression list covers Text, Number, Boolean, Blank, reached Errors, wrong types and arities,
UTF-16 length, culture-sensitive casing examples, supplementary characters, and simple-casing
expansion cases. The float and decimal TSVs are generated from the pinned Power Fx checkout:

```sh
for mode in float decimal; do
  dotnet run --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- \
    probe "$mode" docs/research/scalar-text-probes/expressions.txt \
    > "docs/research/scalar-text-probes/reference.v1-${mode}.tsv"
  dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- \
    probe "$mode" docs/research/scalar-text-probes/expressions.txt \
    > "packages/engine/test/fixtures/scalar-text-probe.${mode}.tsv"
done
```

The casing data is a frozen en-US simple-case snapshot in
`packages/interpreter/src/functions/text-case-map.ts`. It is derived from the same API called by the
pinned interpreter (`runner.CultureInfo.TextInfo.ToLower/ToUpper`), using the installed .NET runtime.
Generation also verifies every Unicode scalar against that runtime before writing the table; the
`verify` action independently parses the checked-in table and repeats that exhaustive comparison:

```sh
dotnet run --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- \
  case-map generate packages/interpreter/src/functions/text-case-map.ts
dotnet run --no-build --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- \
  case-map verify packages/interpreter/src/functions/text-case-map.ts
```

The generator refuses to run unless `upstream/Power-Fx` is at
`df4ceba5e08220db670c25afead342ce699c50b5`. Relevant pinned sources are:

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/StringOneArgFunction.cs`,
  `Texl/Builtins/Len.cs`, and `Texl/Builtins/LowerUpper.cs` for scalar typing and checks.
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryText.cs` for `Len` and
  `TextInfo` casing evaluation.
- `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/Len.txt`,
  `Lower.txt`, and `Upper.txt` for corpus behavior.

The upstream commit does not pin .NET globalization data. The committed snapshot records the
generator's runtime version; its exact active ICU provider was not independently identifiable on
the generation host. Do not refresh this snapshot as routine maintenance: a refresh requires review
of runtime provenance and reference behavior. The implementation uses the checked-in table rather
than host JavaScript or .NET casing APIs, so runtime upgrades do not silently change formula
results.
