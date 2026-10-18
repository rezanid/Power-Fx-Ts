# ADR 0014: `IsEmpty`

Status: **accepted (Option A), independently reviewed, implemented, and merged** in PR #16
(`d600b74806c0b4fd22ef476cf9da2e78f86b9abb`; merge commit
`4a1b2de18ae0fa323f106526b70e6a365225ac7d`).
Upstream pin `df4ceba5e08220db670c25afead342ce699c50b5`. Baseline `main` `984a61b` (after PR #15).
Archived scope: `docs/milestones/0014-isempty-milestone-spec.md`.

## Context

Under PowerFxV1, `RestrictedIsEmptyArguments` accepts a table or Blank and rejects other typed
arguments. The upstream corpus has 34 cases; the reviewed classification identifies 18 reachable
cases and 16 exclusions. The existing function registry had no generic argument-type validation
result, while its generic arity path already provides the required arity diagnostics.

## Decision: Option A

`FunctionCheck` may return indexed argument-type errors. After its existing generic arity check, the
binder emits `BadTypeExpected` at each indicated argument and recovers with the signature's return
type. `IsEmpty` uses this path to accept Table/Blank and diagnose other types as
`Invalid argument type (X). Expecting a Table value instead.` The error is precise: no extra generic
invalid-arguments diagnostic is added. The shared `typeName()` renders Decimal as `Number`, matching
both reference profiles.

`IsEmpty` is registered with one eager argument and a Boolean return type. Evaluation evaluates the
argument once, propagates an Error value, returns true for Blank, and otherwise tests whether a
Table's row array is empty. Blank and Error rows count as rows; no row is visited by `IsEmpty`.
Existing cancellation and evaluation-budget accounting applies to the call and its evaluated
argument. The result uses the existing frozen Boolean constructor.

`IsEmpty` was already in `KNOWN_UPSTREAM_FUNCTIONS`; that classification is retained. No coercion,
`emptyTextAsBlank`, table-literal, host-validation, or backend behavior changes.

## Scope exclusions

- All-Blank table literals remain unsupported, including corpus lines 53 and 56. `Table(Blank())`
  and tables containing records whose fields are Blank remain supported.
- The other 14 corpus cases requiring Date/Time/DateTime, `LastN`, `Sqrt`, `Len`, or `ParseJSON`
  remain unsupported.
- Legacy unrestricted arguments, `IsEmpty_UO`, other table functions, and `IsBlank` semantics are
  unchanged.

## Evidence

- The pinned C# reference probes are committed under `docs/research/isempty-probes/`; the added
  probes confirm Error propagation for table-typed `If`/`With` results and precise diagnostic
  recovery. Float and Decimal reference fixtures are replayed by
  `packages/engine/test/isempty.test.ts`.
- Runtime tests cover Blank and table values, row semantics, the excluded all-Blank literal
  classification, frozen Boolean results, a skipped lazy branch, budget exhaustion, and
  cancellation in both profiles.
- Both compatibility profiles have exactly 18 `unsupported` → `pass` transitions and zero
  pass-to-non-pass regressions. All 16 excluded cases remain unsupported. Per-case transitions and
  totals: `docs/research/isempty-before-after.md`.
- Independent review passed before owner acceptance and merge. CI passed on final PR head
  `d600b74806c0b4fd22ef476cf9da2e78f86b9abb` (run
  [39166838346](https://github.com/rezanid/Power-Fx-Ts/actions/runs/39166838346)) and merge commit
  `4a1b2de18ae0fa323f106526b70e6a365225ac7d` (run
  [39167949555](https://github.com/rezanid/Power-Fx-Ts/actions/runs/39167949555)).

## Known limits

Untyped objects, non-V1 behavior, and functions used by the excluded corpus cases are not supported.
The reviewed milestone scope does not change table-literal typing to make all-Blank literals
reachable.
