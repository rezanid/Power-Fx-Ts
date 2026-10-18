# Next milestone (proposal): `IsEmpty`

Status: **PROPOSED**. Not accepted, not implemented. Research only (2026-10-18). Do not implement until the owner
accepts the scope and the decision below.

Upstream pin `df4ceba5e08220db670c25afead342ce699c50b5`. Baseline: `main` `5cf1d25`. Profiles: `v1-float`,
`v1-decimal` (PowerFxV1, en-US). Prior art: ADR 0012/0013, `Filter`/`With` binder special forms.

## Upstream behavior (evidence)

- `Texl/Builtins/IsEmpty.cs`: `IsEmpty(table)`, exactly 1 argument, returns Boolean. Under PowerFxV1,
  `RestrictedIsEmptyArguments` is on (`Features.cs`, the V1 feature set; the corpus file declares
  `#SETUP: RestrictedIsEmptyArguments`), so the argument is checked against an empty table type and any
  non-table is a compile error. A second overload `IsEmpty_UO` takes untyped objects (out of scope).
- Runtime (`Interpreter/Functions/Library.cs:2234`): Blank → `true`; Table → `!Rows.Any()`; anything else →
  runtime type mismatch (unreachable for typed formulas). Arguments are evaluated once; an Error argument
  propagates (generic function error handling).
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
4. Reachable corpus cases: 20 of 34 (`IsEmpty([1234])`-style literals, `Table(...)`, Blank forms, `[1/0]`,
   `Filter([1,2,3], Value > 10)`, the four invalid-argument diagnostics).

## Exclusions

- The 14 corpus cases that need other unimplemented features remain `unsupported`, reported explicitly, not
  approximated: `Date`/`Time`/`DateTime*` (lines 32, 35, 38, 96, 100, 104, 108), `LastN` (68), `Sqrt` (77), `Len`
  (88, 92), `ParseJSON`/untyped objects (118, 121, 124).
- Legacy (non-restricted) `IsEmpty` accepting any type; `IsEmpty_UO`; other table functions (`Count*`,
  `LastN`, `Sort`…); `IsBlank` semantics (unchanged); coercion changes; backend or host-validation changes.

## Dependency and architectural issue (decide before implementation)

`FunctionCheck` (`packages/core/src/functions/signature.ts`) has no way to report argument-type diagnostics:
`check` returns only a return type and coercions, and today's builtins accept anything. `IsEmpty` needs a
type error. Options:

- **A (recommended, smallest):** add an optional diagnostics/argument-validation result to `FunctionCheck`
  (for example `invalidArgs?: { index, expected }[]`) that the binder turns into `BadTypeExpected`; generic and
  reusable by later functions; no change to existing functions.
- **B:** bind `IsEmpty` as a binder special form like `With`/`Filter`; no registry change but not reusable
  and duplicates arity/diagnostic plumbing.

Owner decision requested: A or B. Also confirm that the diagnostic type name follows existing
`typeName()` rendering (in the decimal profile the corpus says `Decimal` for a numeric literal argument; the
strict-diagnostic comparison is informational and containment decides pass).

## Tests (reference-backed, both profiles)

- Replay `docs/research/isempty-probes/` (expressions, canonical type/result or `ERRORS:`) as fixtures with the
  `packages/engine/test/reference-probe.ts` helpers; regenerate with the harness `probe` command; add a few
  more probes for runtime Error arguments produced via supported constructs before accepting.
- Corpus: the 20 reachable cases pass in both profiles; the other 14 stay `unsupported`.
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
v1-float|v1-decimal`. Expect up to 20 `unsupported` → `pass` per profile in `IsEmpty.txt`; require zero
pass-to-non-pass regressions and explain every transition; ADR 0014, before/after note, handoff update, draft
PR, CI green on the final commit, independent review.
