# Milestone 0015: `IsBlankOrError`

Status: **PROPOSED**. This is a documentation proposal only; it has not been accepted or implemented.
Do not begin implementation until the owner accepts the reviewed scope.

Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`. Proposed baseline: `main`
`4a1b2de18ae0fa323f106526b70e6a365225ac7d` (PR #16 merge). Profiles: `v1-float` and `v1-decimal`,
PowerFxV1, en-US, UTC. Prior art: ADR 0014 (`FunctionCheck` and eager builtin evaluation), current
`IsBlank` signature and implementation.

## Why this milestone

`IsBlankOrError` is a small, useful companion to the existing `IsBlank`: callers can test for either a
blank/empty value or a runtime error without changing `IsBlank`'s existing error-propagation behavior.
The engine already represents Blank, empty Text, and Error values and has a reusable builtin signature,
implementation map, evaluator, and frozen Boolean constructor. `IsBlankOrError` is already classified as
a known upstream function, so this fills an existing language gap without adding syntax, types, host
capabilities, or a new binding mechanism.

This is a lower-risk next slice than `IfError`, which would require multi-argument error recovery and
additional laziness/type-union semantics. Unlike a corpus-count-only choice, `IsBlankOrError` directly
reuses the existing blank predicate and exercises an existing runtime Error value at a one-argument
function boundary.

## Pinned upstream evidence

- `Texl/Builtins/IsBlankOrError.cs` defines a one-argument Boolean function based on the shared blank
  function type rules; the separate OptionSet overload is outside the current engine's supported types.
- `Texl/Builtins/IsBlank.cs` shows that the ordinary overload accepts general expression types and
  excludes OptionSet values for a separate overload.
- `Interpreter/Functions/Library.cs` registers `IsBlankOrError` without standard error propagation and
  returns true when `IsBlankOrEmpty(arg)` is true or the argument is an `ErrorValue`; otherwise it returns
  false. `IsBlankOrEmpty` includes Blank and empty Text.
- The pinned `IsBlankOrError.txt` corpus has three reference cases: a Blank result from `If` returns true,
  ordinary nonempty Text returns false, and an Error produced while evaluating an `If` condition returns
  true.

All source and corpus references above are from
`df4ceba5e08220db670c25afead342ce699c50b5`; no upstream code or test data is copied by this proposal.
Before implementation, add reference-harness probes in both numeric modes for the meaningful cases below
and commit the generated output as fixtures rather than hand-writing expected results.

## Scope

1. Register and implement `IsBlankOrError` as a one-argument, eager builtin returning Boolean.
2. Evaluate its argument once. Return true for Blank, empty Text, or a runtime Error value; return false
   for other supported values. Confirm each case against the pinned reference before implementation.
3. Reuse the existing blank/empty-text predicate where the reference confirms equivalent behavior. Do not
   alter `IsBlank`, generic Error propagation, or `IsEmpty`.
4. Consume a reached Error by returning the existing frozen Boolean `true`, not by propagating or exposing
   its payload. Use existing generic arity diagnostics for zero or multiple arguments; do not add an
   argument-type restriction.

## Exclusions

- `IfError`, `IsError`, error construction/handling redesign, and changes to ordinary Error propagation.
- OptionSet values, controls, untyped objects, host-specific values, and their separate upstream overloads.
- Changes to `IsBlank`, empty-text coercion sites, Blank equality, table/record typing, or error-array shape.
- Additional error-handling functions, syntax, localization, or host capabilities.

## Meaningful reference-backed tests

- Replay every case in pinned `IsBlankOrError.txt` in both profiles.
- Generate and replay probes for `Blank()`, `""`, whitespace Text, ordinary Text, Number, Boolean, supported
  Record/Table values, `1/0`, and an Error returned through a lazy `If`; assert the upstream Boolean result
  and compare diagnostic/type behavior where applicable.
- Check zero- and two-argument diagnostics against the reference.
- Check that a reached Error is consumed by `IsBlankOrError`, while the same Error still propagates through
  `IsBlank`; verify the result is frozen and existing evaluation-budget/cancellation accounting applies.
- Run tests in both numeric modes. Keep compatibility verdicts `invalid` and `unsupported` distinct.

## Acceptance criteria

1. The owner accepts this proposal before implementation. The pinned-reference probes and exact scope are
   recorded before adding the builtin.
2. Every fixture matches pinned Power Fx in both `v1-float` and `v1-decimal`; the three upstream corpus
   cases pass, and all excluded types/functions remain explicitly unsupported or invalid as appropriate.
3. Build, full tests, lint, formatting, both compatibility profiles, and CI pass. Compare each profile with
   the baseline at `4a1b2de18ae0fa323f106526b70e6a365225ac7d`; explain every verdict transition and allow
   zero pass-to-non-pass regressions.
4. Update ADR 0015, archive this specification with final evidence, and update `docs/agent-handoff.md`.
   Record implemented, verified, unsupported, and proposed behavior separately.
