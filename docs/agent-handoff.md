# Agent handoff: current state

Implementation baseline: `820c9be` (`main` after PR #11; code identical to `f2fa9d8`, PR #10). The `Coalesce`
milestone (ADR 0012) is implemented on branch `rezanid-continue-handoff-milestone`, pending review.
Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5` (`docs/provenance.md`).
Profiles: `v1-float` (default, PowerFxV1 + NumberIsFloat) and `v1-decimal` (opt-in
`new Engine({ numberMode: "decimal" })`), culture en-US, UTC.

## Completed milestones (all merged; PRs #2–#10)

Vertical slice (lexer/parser/binder/evaluator, compat runner) → parser parity → typed context and
schema separation → record literals and `With` → tables, row scopes, `Filter`, `ThisRecord`/`As` →
`T.Field`, `First`, `CountRows`, `LookUp` → record/table type unions → Decimal backend →
culture-aware numeric text parsing (en-US, fr-FR) → compat cleanup (cascaded out-of-range-literal
diagnostics, merged operand errors, recovered result types) → `Coalesce` (PR pending review).

## Source and test map

| Area                                           | Location                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lexer, parser, syntax nodes                    | `packages/core/src/lexer/`, `packages/core/src/parser/`, `packages/core/src/syntax/`                      |
| Binder (types, scopes, coercions, diagnostics) | `packages/core/src/binding/binder.ts`                                                                     |
| Bound tree                                     | `packages/core/src/ir/bound-tree.ts`                                                                      |
| Types, schema, record/table unions             | `packages/core/src/types/{formula-type,schema,union}.ts`                                                  |
| Builtin signatures and known names             | `packages/core/src/functions/{signature,known-names}.ts`                                                  |
| Diagnostics and message templates              | `packages/core/src/diagnostics/diagnostic.ts`                                                             |
| Numeric text scanning (core side) / Decimal    | `packages/core/src/numeric/{text-number,decimal}.ts`                                                      |
| Numeric backends (float/decimal), text parsing | `packages/interpreter/src/numeric/{backend,decimal,text-number}.ts`                                       |
| Values (frozen)                                | `packages/interpreter/src/values/values.ts`                                                               |
| Evaluator, coercion                            | `packages/interpreter/src/evaluator/{evaluator,coercion}.ts`                                              |
| Builtin implementations                        | `packages/interpreter/src/functions/builtins.ts`                                                          |
| Runtime context and host-input validation      | `packages/interpreter/src/runtime/{context,validate}.ts`                                                  |
| Engine facade (`check`, `evaluate`)            | `packages/engine/src/engine.ts` (`dependencies/`, `recalc/` are empty placeholders)                       |
| Compat runner, profiles, reports               | `packages/test-suite/src/*.ts`; committed `packages/test-suite/reports/*.engine.md`                       |
| Behavior tests and reference fixtures          | `packages/engine/test/*.test.ts`, `packages/engine/test/fixtures/*.json`                                  |
| Executable C# reference                        | `tools/reference-harness/Program.cs` (`eval`, `check`, `generate`, `parse`, `probe`)                      |
| Language service, serialization, test-runner   | `packages/language-service`, `packages/serialization`, `packages/test-runner`: skeletal, not yet in scope |

## Accepted decisions (details in ADRs)

- ADR 0001 packages; 0002 profiles/numerics; 0003 engine design; 0004 typed context/schema;
  0005 records/`With`; 0006 tables and row scopes (`Filter` evaluates the predicate for every row,
  including Error rows); 0007 `First`/`CountRows`/`LookUp`; 0008 record/table unions (explicit
  `Conform` nodes; `If` lazy); 0009 Decimal (opt-in, float default retained); 0010 numeric text
  parsing (en-US/fr-FR; unsupported locales are a run-time `unsupported` after Blank/error
  precedence); 0011 literal diagnostics and merged errors; 0012 `Coalesce` (`emptyTextAsBlank` coercion flag;
  fold-time coercions; record/table conformance).
- Custom numeric backends must implement `fromScanned` (ADR 0010 migration notes).
- Evaluation-budget accounting is per evaluated node; exact upstream step counts are not required.

## Known gaps

- Compat (committed reports): `v1-float` 2207 pass / 1 fail / 46 skip / 12705 unsupported;
  `v1-decimal` 2737 / 1 / 56 / 13379 (with `Coalesce`; previously 2147/…/12765 and 2665/…/13451). The one failure in each is `Text_ExcelCompat_PowerFxV1Compat.txt:13`
  (`Text()` formatting). Most unsupported cases are unimplemented builtins (e.g. `IfError`, `IsEmpty`, math/text/date functions, `Text`).
- `If(false,1,"")`, `If(false,{a:1},{a:""})` and `[{a:1},{a:""}]` give 0/false where upstream gives Blank
  (ADR 0012); `Coalesce` is correct via `emptyTextAsBlank`.
- Float `^` last-ulp differences; `If(1E100, …)` condition diagnostic; aggregate (record/table)
  equality; locales beyond en-US/fr-FR; culture-specific formatting; option sets, untyped objects,
  dates/times, behavior functions, delegation, connectors, editor UI.

## Verification evidence

Historical semantic evidence (recorded in PR #10, **not re-run** for this documentation PR): at
`59e68db`, whose tree is identical to baseline `f2fa9d8`, build, lint, format and 438 tests passed;
both compat profiles produced the counts above with 0 per-case pass-to-non-pass regressions against
the PR #9 baseline (`docs/research/compat-cleanup-before-after.md`). Baseline CI: GitHub Actions
run for `f2fa9d8` on `main` reported success when this handoff was prepared
(`gh run list --branch main`); no durable run URL was recorded, so treat it as previously
reported evidence without an independently linked run (find it in the repository's Actions tab
for commit `f2fa9d8`).

Checks for this documentation PR (#11): `pnpm format:check` and a path/link check of the files
referenced by these documents. Nothing else was run.

## Stale ADR status labels

ADRs 0004 (`proposed`) and 0005–0009 (`provisional (milestone review pending)`) still carry their
original labels although their milestone PRs were reviewed and merged; ADR 0001–0003, 0010 and 0011
are `accepted`. This PR does not change any status or accept any new decision; the owner may update
the labels separately.

## Reports and research

`docs/research/` (`upstream-inventory.md`, `decimal-before-after.md`, `numeric-text-before-after.md`,
`compat-cleanup-before-after.md`); `packages/test-suite/reports/`.

## Next

Proposal only (not started): `docs/milestones/next.md` lists `IfError` or `IsEmpty`; owner decides.
Verification evidence for `Coalesce`: `docs/research/coalesce-before-after.md`.
