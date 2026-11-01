# IsBlankOrError reference probes

`expressions.txt` and `reference.v1-{float,decimal}.tsv` were generated with the reference harness
against Power Fx commit `df4ceba5e08220db670c25afead342ce699c50b5`. The result fixtures under
`packages/engine/test/fixtures/` are the same generated TSVs and are replayed in both numeric
profiles.

The reference confirms that Blank, empty Text, and reached Error values return true; whitespace
Text and other supported values return false. A skipped Error in a lazy `If` branch is not visited.
The same reached division-by-zero Error remains an Error through `IsBlank`. Calls with zero or two
arguments produce the reference arity diagnostics.

To regenerate from the repository root:

```sh
dotnet run --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe float docs/research/isblankorerror-probes/expressions.txt > docs/research/isblankorerror-probes/reference.v1-float.tsv
dotnet run --project tools/reference-harness -p:EnableSourceControlManagerQueries=false -- probe decimal docs/research/isblankorerror-probes/expressions.txt > docs/research/isblankorerror-probes/reference.v1-decimal.tsv
```

The MSBuild property disables SourceLink repository metadata discovery only; it is needed here
because the installed Git metadata reader does not support the upstream checkout's repository
format. It does not change Power Fx evaluation or reference results.
