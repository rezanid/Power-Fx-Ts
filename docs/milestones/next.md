# Next milestone (proposal): `IsEmpty`

Status: **PROPOSED** (corrected after review of PR #14). Not accepted, not implemented. Do not implement until the
owner accepts the scope and the decision below.

Upstream pin `df4ceba5e08220db670c25afead342ce699c50b5`. Baseline: `main` `5cf1d25`. Profiles: `v1-float`,
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

## Dependency and architectural issue (decide before implementation)

`FunctionCheck` (`packages/core/src/functions/signature.ts`) returns only a return type and coercions; the
binder does validate arguments for existing special paths (`With`, `Filter`, operators, `Coalesce` arity/typing
in the binder), but ordinary registry functions have no argument-type validation result. `IsEmpty` needs one.
Options:

- **A (recommended, kept minimal):** add an optional argument-validation result to `FunctionCheck` that the
  binder turns into `BadTypeExpected` after the existing generic arity check; reusable by later functions; no
  change to existing functions.
- **B:** a targeted binder validation hook for `IsEmpty` (as `Coalesce` has binder-side handling); it can also
  reuse the generic arity checks, so duplication is not inherent, but it is less reusable.

Owner decision requested: A or B. Either must reproduce the upstream diagnostics: the error span is the
argument; no extra generic "invalid arguments" diagnostic (`HasPreciseErrors`); the call's result type stays
Boolean so enclosing expressions recover without cascading errors (probe `If(IsEmpty(0),1,2)` before
implementing to confirm the reference's recovery).

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

Baseline per-case artifacts generated in an isolated worktree at the baseline commit; then
`pnpm build && pnpm test && pnpm lint && pnpm format:check` and `pnpm --filter @powerfx-ts/test-suite compat
v1-float|v1-decimal`. Expect up to 18 `unsupported` → `pass` per profile in `IsEmpty.txt`; require zero
pass-to-non-pass regressions and explain every transition; ADR 0014, before/after note, handoff update, draft
PR, CI green on the final commit, independent review.
