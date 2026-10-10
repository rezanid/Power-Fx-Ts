# Agent handoff: current state

Implementation baseline: `f2fa9d848db797a0868d45e4897bf7527379d884` (`main` after PR #10).
Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5` (`docs/provenance.md`).
Profiles: `v1-float` (default, PowerFxV1 + NumberIsFloat) and `v1-decimal` (opt-in
`new Engine({ numberMode: "decimal" })`), culture en-US, UTC.

## Completed milestones (all merged; PRs #2–#10)

Vertical slice (lexer/parser/binder/evaluator, compat runner) → parser parity → typed context and
schema separation → record literals and `With` → tables, row scopes, `Filter`, `ThisRecord`/`As` →
`T.Field`, `First`, `CountRows`, `LookUp` → record/table type unions → Decimal backend →
culture-aware numeric text parsing (en-US, fr-FR) → compat cleanup (cascaded out-of-range-literal
diagnostics, merged operand errors, recovered result types).

## Source and test map

| Area                                                      | Location                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Lexer, parser, syntax nodes                               | `packages/core/src/{lexer,parser,syntax}`                                                     |
| Binder (types, scopes, coercions, diagnostics)            | `packages/core/src/binding/binder.ts`; bound tree `ir/bound-tree.ts`                          |
| Types, symbols, function signatures                       | `packages/core/src/{types,symbols,functions}` (`functions/signature.ts` = builtin signatures) |
| Numeric backends, text parsing                            | `packages/core/src/numeric`, `packages/interpreter/src/numeric`, `core/src/text`              |
| Diagnostics/templates                                     | `packages/core/src/diagnostics/diagnostic.ts`                                                 |
| Values (frozen), evaluator, coercion, builtins            | `packages/interpreter/src/{values,evaluator,functions}`                                       |
| Engine facade (`check`, `evaluate`), recalc, dependencies | `packages/engine/src`                                                                         |
| Compat runner, profiles, reports                          | `packages/test-suite` (`reports/*.engine.md` committed)                                       |
| Behavior tests                                            | `packages/engine/test/*.test.ts` (reference vectors in `fixtures/`)                           |
| Executable C# reference                                   | `tools/reference-harness` (`eval`, `check`, `generate`, `parse`)                              |
| Language service, serialization, test-runner              | skeletal packages, not yet in scope                                                           |

## Accepted decisions (details in ADRs)

- ADR 0001 packages; 0002 profiles/numerics; 0003 engine design; 0004 typed context/schema;
  0005 records/`With`; 0006 tables and row scopes (`Filter` evaluates the predicate for every row,
  including Error rows); 0007 `First`/`CountRows`/`LookUp`; 0008 record/table unions (explicit
  `Conform` nodes; `If` lazy); 0009 Decimal (opt-in, float default retained); 0010 numeric text
  parsing (en-US/fr-FR; unsupported locales are a run-time `unsupported` after Blank/error
  precedence); 0011 literal diagnostics and merged errors.
- Custom numeric backends must implement `fromScanned` (ADR 0010 migration notes).
- Evaluation-budget accounting is per evaluated node; exact upstream step counts are not required.

## Known gaps

- Compat (committed reports): `v1-float` 2147 pass / 1 fail / 46 skip / 12765 unsupported;
  `v1-decimal` 2665 / 1 / 56 / 13451. The one failure in each is `Text_ExcelCompat_PowerFxV1Compat.txt:13`
  (`Text()` formatting). Most unsupported cases are unimplemented builtins (e.g. `Coalesce`,
  `IfError`, `IsEmpty`, math/text/date functions, `Text`).
- Float `^` last-ulp differences; `If(1E100, …)` condition diagnostic; aggregate (record/table)
  equality; locales beyond en-US/fr-FR; culture-specific formatting; option sets, untyped objects,
  dates/times, behavior functions, delegation, connectors, editor UI.

## Verification evidence

Previously recorded (PR #10, not re-run for this handoff): at `59e68db` (last code commit, tree
identical to the baseline apart from the merge commit) build, lint, format and 438 tests passed;
both compat profiles produced the counts above with 0 per-case pass-to-non-pass regressions against
the PR #9 baseline (`docs/research/compat-cleanup-before-after.md`). GitHub CI on the baseline SHA
`f2fa9d8`: success (checked at handoff time via `gh run list`).
Run now: none; this handoff is documentation-only. Re-run the commands in `AGENTS.md` before
starting new work to confirm a clean baseline.

## Reports and research

`docs/research/` (`upstream-inventory.md`, `decimal-before-after.md`, `numeric-text-before-after.md`,
`compat-cleanup-before-after.md`); `packages/test-suite/reports/`.

## Next

Proposal: `docs/milestones/next.md` (PROPOSED, awaiting owner acceptance).
