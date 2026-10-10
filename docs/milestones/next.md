# Next milestone: `Coalesce`

Status: **PROPOSED** (not accepted; do not implement until the owner approves).

## Why this is next

`Coalesce.txt` (77 cases, 0 passing) and `Coalesce_V1Compat.txt` (5) are fully unsupported. It is one
function, and it exercises exactly what the project already built and verified: lazy argument
evaluation, Blank/error propagation and the `If` result-type union (ADR 0008) — while adding the
one missing piece, Blank-or-empty-text testing. It is a small step toward the plan's Phase 2
error/Blank behavior without opening a function family, new value kinds, or culture work.

## Included

- `Coalesce(arg1, arg2, …)`, one or more arguments, in `PowerFxV1` rules (`CheckTypesLatest`).
- Result type: fold `DType.TryUnionWithCoerce(left, right, coerceToLeftTypeOnly: true)` over the
  arguments, skipping Blank-typed arguments; reuse the `If` union and explicit `Conform` nodes.
  Void/Error-typed arguments are diagnostics; incompatible unions follow the existing unsupported
  or invalid outcome used by `If`.
- Evaluation: first argument eager, the rest lazy, left to right. Return the first value that is not
  Blank and, for Text, not the empty string; an Error argument is returned as soon as it is reached
  (`Coalesce.cs` runtime in `LibraryText.cs`); if every argument is Blank/empty return Blank.
  Budget ticks and cancellation per evaluated node; frozen results.
- Both numeric profiles; Decimal/Float arguments follow the existing union and numeric rules.

## Excluded

Table/record-valued `Coalesce` beyond what the existing union already supports (report remaining
shapes as `unsupported`), `IsBlank`/`IsEmpty` changes, `IfError`, other functions, option sets,
untyped objects, side-effect (behavior) functions, editor UI.

## Upstream evidence

- `src/libraries/Microsoft.PowerFx.Core/Texl/Builtins/Coalesce.cs` (arity, `IsLazyEvalParam`,
  `CheckTypesLatest` vs legacy).
- `src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryText.cs` `Coalesce` and its
  registration in `Library.cs` (`NoErrorHandling`).
- Corpus: `Coalesce.txt`, `Coalesce_V1Compat.txt` (applicability per profile; first inspect every
  case and classify it before implementing).
- Run the C# reference harness `eval`/`check` for each result-type and error/Blank edge to settle
  anything the corpus does not state; record results in an ADR.

## Reuse

`ifAggregateUnion`/`conformTo` and the signature table in `binder.ts`/`signature.ts`; lazy-call
handling used by `If`; value constructors and `deepFreeze`; budget `tick()`; compat runner and
reference vectors in `packages/engine/test/fixtures`.

## Semantic tests

- Result types (both profiles): same type, Blank first/last, Number+Decimal, Text+Number (left-type
  coercion), record/table unions already supported by `If`, incompatible types.
- Runtime: Blank and `""` skipped; `" "` not empty; all-empty → Blank; single argument; Error
  reached vs short-circuited (later arguments must not be evaluated, including side effects of
  budget ticks); Error before and after a non-blank value; nested `Coalesce`; use with
  `Filter`/`LookUp`/`With` scopes and variables.
- Cancellation and budget exhaustion mid-argument-list; frozen results; unchanged behavior of `If`.
- Diagnostics: arity, void/error argument types, cascade with out-of-range literals.

## Acceptance criteria

1. ADR documents rules, corpus classification and any deviations.
2. All applicable `Coalesce*.txt` cases are pass or explicitly classified unsupported with reasons.
3. Reference-backed regression tests added; build, test, lint, format pass.
4. `v1-float` and `v1-decimal` reports rerun; per-case diff shows zero pass-to-non-pass regressions.
5. Draft PR with before/after counts and limitations; CI green on the final commit; no merge.

## Open decision for the owner

Approve `Coalesce`, or prefer `IfError` (56 cases, needs error-value semantics) or `IsEmpty`
(34 cases, needs table/Blank rules).
