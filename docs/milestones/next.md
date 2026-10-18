# `IsEmpty` milestone

Status: **IMPLEMENTED**; scope accepted by the owner (Option A); independent review pending; not merged.

Upstream pin `df4ceba5e08220db670c25afead342ce699c50b5`. Baseline: `main` `984a61b`. Profiles: `v1-float`,
`v1-decimal` (PowerFxV1, en-US). Prior art: ADR 0012/0013, `Filter`/`With` binder special forms.

## Upstream behavior (evidence)

- `Texl/Builtins/IsEmpty.cs`: `IsEmpty(table)`, exactly 1 argument, returns Boolean. Under PowerFxV1,
  `RestrictedIsEmptyArguments` is on (`Features.cs`, the V1 feature set; the corpus file declares
  `#SETUP: RestrictedIsEmptyArguments`), so the argument is checked against an empty table type and any
  non-table is a compile error. A second overload `IsEmpty_UO` takes untyped objects (out of scope).
- Runtime (`Interpreter/Functions/Library.cs:2234`): Blank → `true`; Table → `!Rows.Any()`; anything else →
  runtime type mismatch (unreachable for typed formulas). Arguments are evaluated once; an Error-valued table
  argument propagates through the registered standard error handling (not probed here; a scalar such as
  `IsEmpty(1/0)` is a compile error, not a propagation test).
- Reference probes (`docs/research/isempty-probes/`, 26 expressions, identical across profiles except the
  numeric kind of the surrounding expression): `[]`, `Blank()`, `If(false,[…])` (Blank), `Table()`,
  `Coalesce(Blank(),[])` → `true`; `[Blank()]`, `[1/0]`, `Table({a:1/0})`, `[""]`, `Table({a:1},Blank())` →
  `false` (rows that are Blank or Error still count); `If(true,Blank(),[1])` → `true`.
  Compile errors: `IsEmpty("")`/`({})`/`(0)`/`(false)`/`(1/0)` → `Invalid argument type (Text|Record|Number…).
Expecting a Table value instead.`; arity → `Invalid number of arguments: received N, expected 1.`
- Corpus: `IsEmpty.txt`, 34 cases, all currently `unsupported` in both profiles.

## Scope

1. Register `IsEmpty` (1 argument, Boolean result) in the shared signature registry and implement it in the
   interpreter; add to name handling consistently with existing builtins (`known-names`).
2. Typing: accept Table and Blank (typed Blank, e.g. `Blank()`, `If(cond, table)`); reject other types with
   the reference diagnostic (`PFX2008`, "Invalid argument type ({1}). Expecting a {0} value instead.", args
   `Table`, actual type; span is the argument). Arity via the existing `BadArity` path.
3. Evaluation: Blank → `true`; Table → rows empty? Rows that are Blank/Error values count as rows. An Error
   argument propagates. Result is a frozen Boolean.
4. Reachable corpus cases: **18 of 34** (`IsEmpty([1234])`-style literals, `Table(...)` including
   `Table(Blank())`/`Table({a:Blank()})`, `[]`, `Blank()`, `If(1<0,[…])`, `[1/0]`, `Filter([1,2,3], Value > 10)`,
   the four invalid-argument diagnostics).

## Exclusions

- Table literals containing only Blank values (binder `Table of only Blank values`, `binder.ts` ~704) stay
  unsupported: corpus lines 53 `IsEmpty([Blank()])` and 56 `IsEmpty([Blank(),…])`, and the reference probes for
  `[Blank()]` (marked excluded in the fixtures). Supporting them would be separate scope that must be proposed
  explicitly (it touches table-literal typing).
- The 14 further corpus cases that need other unimplemented features remain `unsupported`, reported explicitly,
  not approximated (16 excluded in total): `Date`/`Time`/`DateTime*` (lines 32, 35, 38, 96, 100, 104, 108), `LastN` (68), `Sqrt` (77), `Len`
  (88, 92), `ParseJSON`/untyped objects (118, 121, 124).
- Legacy (non-restricted) `IsEmpty` accepting any type; `IsEmpty_UO`; other table functions (`Count*`,
  `LastN`, `Sort`…); `IsBlank` semantics (unchanged); coercion changes; backend or host-validation changes.

## Accepted decision: Option A

`FunctionCheck` (`packages/core/src/functions/signature.ts`) returns only a return type and coercions; the
binder does validate arguments for existing special paths (`With`, `Filter`, operators, `Coalesce` arity/typing
in the binder), but ordinary registry functions have no argument-type validation result. `IsEmpty` needs one.

The owner accepted **Option A**: add optional argument-type errors to `FunctionCheck`; after the existing
generic arity check the binder reports `BadTypeExpected` at each indicated argument and returns the declared
Boolean type for recovery. This is reusable by later functions and does not change existing signatures.
Option B was not selected. The reference probe `If(IsEmpty(0),1,2)` confirms the argument-only diagnostic
and recovery without a cascading diagnostic.

Settled by evidence (documentation only, no decision needed): the diagnostic names the actual type `Number` in
both profiles, including `IsEmpty(0)` in decimal mode (`isempty-probes/reference.v1-decimal.tsv`); the existing
`typeName()` matches, and the corpus's older `Decimal` wording is handled by the runner's existing
normalization.

## Tests (reference-backed, both profiles)

- Replay `docs/research/isempty-probes/` (expressions, canonical type/result or `ERRORS:`) as fixtures with the
  `packages/engine/test/reference-probe.ts` helpers; regenerate with the harness `probe` command; add probes for
  Error-valued table arguments through supported constructs (e.g. a table-valued `If`/`With` result), and for
  diagnostic recovery.
- Corpus: the 18 reachable cases pass in both profiles; the other 16 stay `unsupported`.
- Behavior: Blank and empty-table forms; Blank/Error/`""` rows are rows; the result feeds `If`, `&&`, `Coalesce`
  conditions; Decimal and Float surroundings.
- Compile errors for each non-table type, arity 0 and 2; diagnostics contain the reference messages.

## Runtime safety and invariants

- Evaluation budget and cancellation apply to the argument and to the call node; no iteration over rows (only
  emptiness is tested, O(1)), so no new unbounded loop. A skipped `If` branch containing `IsEmpty` does not
  execute or cost budget. Test cancellation after evaluation starts and `maxSteps` exhaustion in both profiles.
- Results recursively frozen; no mutation of the argument; no DOM/Node/network dependence; no new host
  capability; `coerceValue` and `emptyTextAsBlank` handling unchanged.
- Existing verdict rules unchanged: `unsupported` ≠ `invalid`; compile-diagnostic cases pass on containment;
  exact Decimal comparison; upstream float tolerance; strict diagnostics informational.

## Final verification gates

Baseline per-case artifacts were generated in an isolated worktree at `984a61b` (main after PR #15).
`pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check`, and both compatibility profiles passed.
Each profile has exactly 18 `unsupported` → `pass` transitions in `IsEmpty.txt`, 16 excluded cases remain
`unsupported`, and there are zero pass-to-non-pass regressions. The per-case transition list and reasons are
recorded in `docs/research/isempty-before-after.md`. The implementation is owner-accepted and awaiting
independent review in a draft PR; it has not been merged. See ADR 0014 for the decision and evidence.
