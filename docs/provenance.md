# Provenance register

Every file or test corpus derived from Microsoft Power Fx is recorded here.

**Pinned upstream commit:** `df4ceba5e08220db670c25afead342ce699c50b5` (2026-10-02)

No upstream code has been copied. Diagnostic message templates PFX2001–PFX2006 reuse the English
wording of upstream `src/strings/PowerFxResources.en-US.resx` (MIT, Copyright Microsoft Corporation)
so compile-error expectations match; the binder, evaluator and number formatting are original,
informed by corpus behavior and `BaseRunner.cs`. The test-suite reader (`packages/test-suite/src/txt-format.ts`,
`profile.ts`, `runner.ts`) is an original implementation of the upstream `.txt` format and applicability
rules, informed by `TestRunner.cs` and `BaseRunner.cs`.

`docs/research/scalar-text-probes/`, `packages/engine/test/fixtures/scalar-text-probe.*.tsv`, and
`docs/research/scalar-text-before-after.cases.tsv` contain reference probe or comparison data
generated from the pinned `Len.txt`, `Lower.txt`, and `Upper.txt` corpus and harness.
`docs/research/dropcolumns-probes/` and
`packages/engine/test/fixtures/dropcolumns-probe.*.tsv` contain reference-generated `DropColumns`
probes from the pinned PowerFxV1 implementation and expression corpus. No upstream implementation
code or test data is copied.
`packages/interpreter/src/functions/text-case-map.ts` is generated from installed .NET
`CultureInfo("en-US").TextInfo` behavior used by pinned `LibraryText.cs`; the harness verifies every
Unicode scalar before generation and when validating the committed snapshot. No upstream
implementation code or test data is copied. Exact commands, source paths, runtime provenance, and
the refresh caveat are recorded in `docs/research/scalar-text-probes/README.md`.

| Our path                                                                                           | Upstream path                                                                                                                                                                                                                                                             | Upstream commit                            | Reuse kind (algorithm / test / data) | Notes                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/research/powerfx-function-registry.tsv`                                                      | `src/libraries/Microsoft.PowerFx.Core/Texl/BuiltinFunctionsCore.cs`; `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunctionSet.cs`; `src/libraries/Microsoft.PowerFx.Core/Functions/TexlFunction.cs`                                                                | `df4ceba5e08220db670c25afead342ce699c50b5` | data                                 | Generated from the pinned assembly by the reference harness `registry` command; records function names, registry fields, implementation types and `OtherKnownFunctions`. No upstream code copied. |
| `docs/research/isempty-probes/`, `packages/engine/test/fixtures/isempty-probe.*.tsv`               | `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/IsEmpty.txt`; reference harness `probe`                                                                                                                                                                | `df4ceba5e08220db670c25afead342ce699c50b5` | data                                 | Reference-produced IsEmpty behavior probes and corpus cases; all-Blank table literal rows are excluded from required-pass fixtures                                                                |
| `docs/research/isblankorerror-probes/`, `packages/engine/test/fixtures/isblankorerror-probe.*.tsv` | `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/IsBlankOrError.txt`; reference harness `probe`                                                                                                                                                         | `df4ceba5e08220db670c25afead342ce699c50b5` | data                                 | Reference-produced probes and corpus behavior; no upstream implementation code or test data copied                                                                                                |
| `docs/research/dropcolumns-probes/`, `packages/engine/test/fixtures/dropcolumns-probe.*.tsv`       | `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/ShowDropColumnsBase.cs`; `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTable.cs`; `src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases/DropColumns_SupportColumnNamesAsIdentifiers.txt` | `df4ceba5e08220db670c25afead342ce699c50b5` | data                                 | Probes generated before implementation with the pinned reference harness; no upstream implementation code or test data copied                                                                     |
