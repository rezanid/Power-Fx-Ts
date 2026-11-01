# ADR 0015: `IsBlankOrError`

Status: **accepted, implemented, and verified** on baseline
`78bd2f7452aa6f14302aaa2b64124b7a5a6259aa`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. Scope:
`docs/milestones/0015-isblankorerror-milestone-spec.md`.

## Decision

Register `IsBlankOrError` as an eager, one-argument Boolean builtin with no argument-type restriction.
Evaluate its argument once and return the frozen Boolean `true` for Blank, empty Text, or a runtime
Error; return `false` for other supported values. Use the existing blank/empty-text predicate,
Boolean value constructor, evaluator accounting, and generic arity diagnostics.

This matches the pinned Power Fx implementation: it registers the builtin without standard Error
propagation, tests `IsBlankOrEmpty(arg)` or `ErrorValue`, and returns Boolean. The ordinary overload
uses the same type rules as `IsBlank`; the distinct OptionSet overload remains outside this engine's
supported types.

## Boundaries

`IsBlank`, ordinary Error propagation, `IsEmpty`, and empty-text coercion sites are unchanged.
`IfError`, `IsError`, OptionSet values, controls, untyped objects, and other host-specific values are
out of scope. No syntax, types, host capabilities, or diagnostic rules are added.

## Evidence

Reference source and all three corpus cases were inspected at the pinned commit. Both-mode generated
probes are recorded in `docs/research/isblankorerror-probes/` and replayed from
`packages/engine/test/fixtures/isblankorerror-probe.*.tsv`. They verify Blank, empty and whitespace
Text, ordinary scalar and aggregate values, reached and skipped Errors, unchanged `IsBlank` Error
propagation, and generic zero-/two-argument diagnostics.

Per-case compatibility comparison against baseline `78bd2f7` is recorded in
`docs/research/isblankorerror-before-after.md`. Each profile has exactly three
`unsupported` → `pass` transitions, all in `IsBlankOrError.txt`, and zero pass-to-non-pass
regressions. Both-mode engine tests also cover frozen Booleans, evaluation budgets, and cancellation.
