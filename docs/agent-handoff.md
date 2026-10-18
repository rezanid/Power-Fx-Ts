# Agent handoff: current state

Implementation baseline: `984a61b` (`main` after PR #15; verified as remote `main` HEAD on
2026-10-18). Previous baselines: `5cf1d25` (PR #13, empty-text coercion), `f9df8bb` (PR #12, `Coalesce`),
`820c9be` (PR #11, docs only), `f2fa9d8` (PR #10).
Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5` (`docs/provenance.md`).
Profiles: `v1-float` (default, PowerFxV1 + NumberIsFloat) and `v1-decimal` (opt-in
`new Engine({ numberMode: "decimal" })`), culture en-US, UTC.

## Completed milestones (PRs #2–#10, #12, #13, all merged)

Vertical slice (lexer/parser/binder/evaluator, compat runner) → parser parity → typed context and
schema separation → record literals and `With` → tables, row scopes, `Filter`, `ThisRecord`/`As` →
`T.Field`, `First`, `CountRows`, `LookUp` → record/table type unions → Decimal backend →
culture-aware numeric text parsing (en-US, fr-FR) → compat cleanup (cascaded out-of-range-literal
diagnostics, merged operand errors, recovered result types) → `Coalesce` (PR #12; spec archived at
`docs/milestones/0012-coalesce-milestone-spec.md`) → empty-text-to-Blank in `If` results, table literals and
`Table(...)` (PR #13; spec `docs/milestones/0013-empty-text-coercion-milestone-spec.md`).

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
  precedence); 0011 literal diagnostics and merged errors.
- ADR 0012 `Coalesce` (accepted; `emptyTextAsBlank` coercion flag, fold-time coercions, record/table
  conformance).
- Custom numeric backends must implement `fromScanned` (ADR 0010 migration notes).
- Evaluation-budget accounting is per evaluated node; exact upstream step counts are not required.

## Merged, acceptance not recorded

- ADR 0013 (merged in PR #13; the ADR's own acceptance is **not recorded**, see its status): keep `emptyTextAsBlank` and enable it explicitly at
  `If` results, table literals and `Table(...)`; `Conform` stays non-universal.

## Current accepted milestone

- `IsEmpty` Option A is owner-accepted and implemented on the current branch. Independent review is pending;
  the implementation is not merged. See ADR 0014, `docs/milestones/next.md`, and the per-case evidence
  in `docs/research/isempty-before-after.md`.
- The implementation adds reusable function-signature argument-type diagnostics after generic arity checks.
  `IsEmpty` accepts Blank/Table, propagates Error, and checks table row emptiness without visiting rows.
- Verification on the current branch: 18 `IsEmpty.txt` cases transition from unsupported to pass in both
  profiles; all 16 reviewed exclusions remain unsupported; zero pass-to-non-pass regressions.

## Known gaps

- Compat on this branch: `v1-float` 2225 pass / 1 fail / 46 skip / 12687 unsupported;
  `v1-decimal` 2755 / 1 / 56 / 13361. The one failure in each is
  `Text_ExcelCompat_PowerFxV1Compat.txt:13` (`Text()` formatting). Remaining unsupported cases are mostly
  unimplemented builtins (e.g. `IfError`, math/text/date functions, `Text`); 16 `IsEmpty` cases remain
  excluded by the accepted milestone scope.
- Empty text in `If` results, table literals and `Table(...)` is Blank (ADR 0013, option B, merged);
  other future retention sites must be probed before enabling `emptyTextAsBlank`.
- Float `^` last-ulp differences; `If(1E100, …)` condition diagnostic; aggregate (record/table)
  equality; locales beyond en-US/fr-FR; culture-specific formatting; option sets, untyped objects,
  dates/times, behavior functions, delegation, connectors, editor UI.

## Verification evidence

Historical semantic evidence (recorded in PR #10, **not re-run** for this documentation PR): at
`59e68db`, whose tree is identical to baseline `f2fa9d8`, build, lint, format and 438 tests passed;
both compat profiles produced v1-float 2147 / 1 / 46 / 12765 and v1-decimal 2665 / 1 / 56 / 13451 (pass / fail /
skip / unsupported; pre-`Coalesce`) with 0 per-case pass-to-non-pass regressions against
the PR #9 baseline (`docs/research/compat-cleanup-before-after.md`). Baseline CI: GitHub Actions
run for `f2fa9d8` on `main` reported success when this handoff was prepared
(`gh run list --branch main`); no durable run URL was recorded, so treat it as previously
reported evidence without an independently linked run (find it in the repository's Actions tab
for commit `f2fa9d8`).

`Coalesce` (PR #12), exact commits: implementation `e97aed4`; final PR head `d4df60d` (tests and docs
only versus `e97aed4`); merge commit `f9df8bb` on `main`. At `d4df60d`: build, lint, format and 927
tests passed locally; PR CI passed (run 38090497080); `main` CI at `f9df8bb` passed (run 38091188532).
Both compat profiles were run on a tree whose source equals `e97aed4`: v1-float 2207 / 1 / 46 / 12705,
v1-decimal 2737 / 1 / 56 / 13379, 0 pass-to-non-pass regressions (`docs/research/coalesce-before-after.md`).
The compat runs were not repeated at `d4df60d`/`f9df8bb` (no source change since `e97aed4`).

Empty-text milestone (PR #13, merge commit `5cf1d25`): implementation commit `f0c7ea9` on baseline `f9df8bb`; build, lint, format and
1109 tests passed locally; both compat profiles had zero per-case transitions against a baseline generated in an
isolated worktree at `f9df8bb` (`docs/research/empty-text-before-after.md`). PR head `4b6fa89` (docs only after
`f0c7ea9`): PR CI run 38091819601 passed; `main` CI at `5cf1d25`: run 38092058232 passed (checked 2026-10-18 via
`gh run list`). The semantic suites and compat runs were **not re-run** for the 2026-10-18 handoff PR (docs only).

## Stale ADR status labels

ADRs 0004 (`proposed`) and 0005–0009 (`provisional (milestone review pending)`) still carry their
original labels although their milestone PRs were reviewed and merged; ADR 0001–0003, 0010, 0011
and 0012 are `accepted`; ADR 0013 is merged without a recorded acceptance. No decision is accepted on the
owner's behalf by documentation PRs; the owner may update the labels separately.

## Reports and research

`docs/research/` (`upstream-inventory.md`, `decimal-before-after.md`, `numeric-text-before-after.md`,
`compat-cleanup-before-after.md`, `coalesce-before-after.md`, `empty-text-before-after.md`,
`isempty-before-after.md`, `empty-text-probes/`, `isempty-probes/`); `packages/test-suite/reports/`.

## Next

Stop for independent review of the `IsEmpty` draft implementation PR. Do not merge or start another
milestone until the owner accepts the review outcome.
