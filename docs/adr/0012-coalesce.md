# ADR 0012: `Coalesce`

Status: accepted (owner-accepted scope; independently reviewed; merged as PR #12, merge commit `f9df8bb`).
Pinned upstream `df4ceba5`. Baseline `main` `820c9be` (implementation baseline `f2fa9d8`).

## Context

`Coalesce.txt` (77 cases) and `Coalesce_V1Compat.txt` (5) were all `unsupported`. Scope and corpus
classification: `docs/milestones/0012-coalesce-milestone-spec.md`.

## Decisions

- **Reference first.** The harness gained `probe <float|decimal> <file>`: for each expression it prints
  the static type and the full canonical result (or the compile errors with spans). 240 expressions
  were run in both numeric modes; the output is committed verbatim as
  `packages/engine/test/fixtures/coalesce-probe.{float,decimal}.tsv` (expressions in
  `coalesce-probe.expressions.txt`) and replayed by `coalesce.test.ts`. Two probes using unimplemented
  functions (`Sqrt`, `Len`) were dropped from the fixtures.
- **Typing** (`foldCoalesce` in `functions/signature.ts`, V1 rules only): Unknown stands for upstream's
  Error type; Blank arguments are skipped; a Blank running type takes the next argument's type;
  otherwise `unionTypes` with the left type winning, and scalar arguments needing it get an explicit
  coercion to the running type at that point. Failures give "Invalid argument type (X). Expecting a Y
  value instead." at the argument (binary expressions at their operator token) plus "invalid arguments"
  at the callee. Error-typed arguments add the new `PFX2023` ("Incompatible type…"); an Error-typed
  first argument makes later non-Blank arguments mismatch against "Error" (verified).
- **Binding** (`bindCoalesce`): scalars get `Coerce` nodes, records/tables get `Conform` nodes to the
  final union (equal to the fold-time sequence because the left type wins). Both carry a new
  `emptyTextAsBlank` flag.
- **Why a flag:** upstream coerces each argument before selection and `""` coerced to Number, Decimal
  or Boolean is Blank (so it is skipped, and `Coalesce("", 1)` etc. match). The shared `coerceValue`
  and `Conform` instead yield `0`/`false`, which `If` relies on today. The flag changes only
  `Coalesce`'s coercions; typed Blank stays Blank.
- **Evaluation** (`coalesceFunction`, lazy): per argument evaluate (budget and cancellation apply to
  evaluated nodes only), return a reached Error unchanged (multi-error values preserved, later
  arguments not evaluated), skip Blank and empty Text, return the first other value (`0`, `false`,
  `" "` and empty tables are returned), else Blank. Results are frozen by the existing constructors.
- Number-to-Text uses the normal numeric format; Boolean-to-Number gives 1/0; Text-to-Boolean accepts
  `true`/`false` case-insensitively; other text is `InvalidArgument` at run time; a Float argument out
  of Decimal range gives `InvalidArgument` (all verified by probes).

## Known deviations and limits

- Pre-existing, not changed (out of scope): `If(false,{a:1},{a:""})`, `If(false,1,"")`,
  `If(false,true,"")` and `[{a:1},{a:""}]` yield Blank upstream; we yield `0`/`false` because
  `coerceValue`/`Conform` map `""` to zero. A future milestone could route them through
  `emptyTextAsBlank` semantics.
- Excluded and still `unsupported`: 35 corpus cases (Left ×4, IfError ×2, Date/Time/DateTime ×29),
  legacy `CheckTypesLegacy`, new value kinds.
- Probes for Error-typed argument cascades are compared by containment, like the compat runner.

## Evidence

`docs/research/coalesce-before-after.md`.
