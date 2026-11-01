# Agent handoff: current state

Current `main` baseline before RenameColumns: `fbbb6c786aba882479806c2e0c36150cf451b156` (ShowColumns
merge commit, PR #22). The current RenameColumns review branch is based on this commit.
IsBlankOrError was implemented from `78bd2f7452aa6f14302aaa2b64124b7a5a6259aa` (PR #17 merge); IsEmpty's
implementation baseline was `984a61b` (after PR #15).
Previous baselines: `5cf1d25` (PR #13, empty-text coercion), `f9df8bb` (PR #12, `Coalesce`),
`820c9be` (PR #11, docs only), `f2fa9d8` (PR #10).
Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5` (`docs/provenance.md`).
Profiles: `v1-float` (default, PowerFxV1 + NumberIsFloat) and `v1-decimal` (opt-in
`new Engine({ numberMode: "decimal" })`), culture en-US, UTC.

## Completed milestones (PRs #2–#10, #12–#13, #16, #18, #20–#22, all merged)

Vertical slice (lexer/parser/binder/evaluator, compat runner) → parser parity → typed context and
schema separation → record literals and `With` → tables, row scopes, `Filter`, `ThisRecord`/`As` →
`T.Field`, `First`, `CountRows`, `LookUp` → record/table type unions → Decimal backend →
culture-aware numeric text parsing (en-US, fr-FR) → compat cleanup (cascaded out-of-range-literal
diagnostics, merged operand errors, recovered result types) → `Coalesce` (PR #12; spec archived at
`docs/milestones/0012-coalesce-milestone-spec.md`) → empty-text-to-Blank in `If` results, table literals and
`Table(...)` (PR #13; spec `docs/milestones/0013-empty-text-coercion-milestone-spec.md`) →
`IsEmpty` and reusable signature argument-type diagnostics (PR #16; archived spec
`docs/milestones/0014-isempty-milestone-spec.md`, ADR 0014) → scalar `Len`, `Lower`, and `Upper`
(PR #20; ADR 0016) → `DropColumns` for static Record/Table values (PR #21; ADR 0017) →
`ShowColumns` for static Record/Table values (PR #22; ADR 0018).

## Source and test map

| Area                                           | Location                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Lexer, parser, syntax nodes                    | `packages/core/src/lexer/`, `packages/core/src/parser/`, `packages/core/src/syntax/`                                                         |
| Binder (types, scopes, coercions, diagnostics) | `packages/core/src/binding/binder.ts`                                                                                                        |
| Bound tree                                     | `packages/core/src/ir/bound-tree.ts`                                                                                                         |
| Types, schema, record/table unions             | `packages/core/src/types/{formula-type,schema,union}.ts`                                                                                     |
| Builtin signatures and known names             | `packages/core/src/functions/{signature,known-names}.ts`                                                                                     |
| Diagnostics and message templates              | `packages/core/src/diagnostics/diagnostic.ts`                                                                                                |
| Numeric text scanning (core side) / Decimal    | `packages/core/src/numeric/{text-number,decimal}.ts`                                                                                         |
| Numeric backends (float/decimal), text parsing | `packages/interpreter/src/numeric/{backend,decimal,text-number}.ts`                                                                          |
| Values (frozen)                                | `packages/interpreter/src/values/values.ts`                                                                                                  |
| Evaluator, coercion                            | `packages/interpreter/src/evaluator/{evaluator,coercion}.ts`                                                                                 |
| Builtin implementations                        | `packages/interpreter/src/functions/builtins.ts`; frozen casing data in `text-case-map.ts`                                                   |
| Runtime context and host-input validation      | `packages/interpreter/src/runtime/{context,validate}.ts`                                                                                     |
| Engine facade (`check`, `evaluate`)            | `packages/engine/src/engine.ts` (`dependencies/`, `recalc/` are empty placeholders)                                                          |
| Compat runner, profiles, reports               | `packages/test-suite/src/*.ts`; committed `packages/test-suite/reports/*.engine.md`                                                          |
| Behavior tests and reference fixtures          | `packages/engine/test/*.test.ts`, `packages/engine/test/fixtures/*.json`                                                                     |
| Executable C# reference                        | `tools/reference-harness/Program.cs` (`eval`, `check`, `generate`, `parse`, `probe`, `showcolumns-probe`, `renamecolumns-probe`, `case-map`) |
| Language service, serialization, test-runner   | `packages/language-service`, `packages/serialization`, `packages/test-runner`: skeletal, not yet in scope                                    |

## Accepted decisions (details in ADRs)

- ADR 0001 packages; 0002 profiles/numerics; 0003 engine design; 0004 typed context/schema;
  0005 records/`With`; 0006 tables and row scopes (`Filter` evaluates the predicate for every row,
  including Error rows); 0007 `First`/`CountRows`/`LookUp`; 0008 record/table unions (explicit
  `Conform` nodes; `If` lazy); 0009 Decimal (opt-in, float default retained); 0010 numeric text
  parsing (en-US/fr-FR; unsupported locales are a run-time `unsupported` after Blank/error
  precedence); 0011 literal diagnostics and merged errors.
- ADR 0012 `Coalesce` (accepted; `emptyTextAsBlank` coercion flag, fold-time coercions, record/table
  conformance).
- ADR 0014 `IsEmpty` (Option A accepted, independently reviewed, implemented, and merged in PR #16).
- ADR 0015 `IsBlankOrError` (accepted, implemented, independently reviewed, and merged in PR #18).
- Custom numeric backends must implement `fromScanned` (ADR 0010 migration notes).
- Evaluation-budget accounting is per evaluated node; exact upstream step counts are not required.

## Merged, acceptance not recorded

- ADR 0013 (merged in PR #13; the ADR's own acceptance is **not recorded**, see its status): keep `emptyTextAsBlank` and enable it explicitly at
  `If` results, table literals and `Table(...)`; `Conform` stays non-universal.

## Earlier completed milestone: `IsEmpty`

- `IsEmpty` Option A was accepted by the owner, passed independent review, and merged in PR #16.
  Final PR head: `d600b74806c0b4fd22ef476cf9da2e78f86b9abb`; merge commit/current main:
  `4a1b2de18ae0fa323f106526b70e6a365225ac7d`. See ADR 0014, its archived spec, and the per-case
  evidence in `docs/research/isempty-before-after.md`.
- The implementation adds reusable function-signature argument-type diagnostics after generic arity checks.
  `IsEmpty` accepts Blank/Table, propagates Error, and checks table row emptiness without visiting rows.
- Verification at final PR head: build, lint, formatting, and all 1,183 tests passed; both profiles have
  exactly 18 `IsEmpty.txt` unsupported-to-pass transitions, all 16 reviewed exclusions remain unsupported,
  and there are zero pass-to-non-pass regressions.

## Most recently completed milestone: `IsBlankOrError`

- Scope and decision: ADR 0015; archived spec `docs/milestones/0015-isblankorerror-milestone-spec.md`.
- Pinned upstream source and corpus were checked out at
  `df4ceba5e08220db670c25afead342ce699c50b5`. Reference probes generated before implementation are
  recorded in `docs/research/isblankorerror-probes/`.
- The builtin reuses the ordinary blank/empty-text predicate and frozen Boolean constructor, consumes
  reached Error values as `true`, and preserves `IsBlank` Error propagation and generic arity diagnostics.
- Both profiles replay all 17 reference probes. Case-level compatibility comparison against baseline
  `78bd2f7` has three `unsupported` → `pass` transitions per profile, all in `IsBlankOrError.txt`, with
  zero pass-to-non-pass regressions. See `docs/research/isblankorerror-before-after.md`.
- OptionSet, controls, untyped objects, and host-specific values remain unsupported/out of scope.
- PR #18 merged at `7825b2a95d767b07b57327f5928fbbb18af55197`.

## Coverage and remaining work

- Research inventory: `docs/research/powerfx-coverage-inventory.md` (source baseline before this
  milestone is `fbbb6c786aba882479806c2e0c36150cf451b156`, upstream pin
  `df4ceba5e08220db670c25afead342ce699c50b5`).
- It counts 145 unique Core-registered upstream function names: 11 implemented in the supported
  slice, 10 partial, 123 missing, and 1 deliberately excluded (`Patch`). Upstream's additional
  `OtherKnownFunctions`, overload scope, method and uncertainty are itemized separately.
- Candidate reports after RenameColumns: `v1-float` 2357 / 1 / 46 / 12555 and `v1-decimal`
  2889 / 1 / 56 / 13227 (pass / fail / skip / unsupported). Do not treat corpus outcomes as
  language completeness.
- Language/runtime foundation is a narrow, tested slice; authoring services are scaffolds; Monaco,
  React, PCF, LSP, connectors and gateway are not implemented. The remaining bounded candidates are
  proposals only.

## Known gaps

- At the IsEmpty baseline (`4a1b2de`): `v1-float` 2225 pass / 1 fail / 46 skip / 12687 unsupported;
  `v1-decimal` 2755 / 1 / 56 / 13361. The PR #19 baseline after IsBlankOrError has
  `v1-float` 2228 / 1 / 46 / 12684 and `v1-decimal` 2758 / 1 / 56 / 13358. The one failure in
  each profile remains
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

`IsEmpty` (PR #16), exact commits: baseline `984a61b`; implementation and final PR head
`d600b74806c0b4fd22ef476cf9da2e78f86b9abb`; merge commit/current main
`4a1b2de18ae0fa323f106526b70e6a365225ac7d`. At the final PR head, build, lint, format, and 1,183
tests passed; both compatibility profiles had exactly 18 `unsupported` → `pass` transitions in
`IsEmpty.txt`, zero pass-to-non-pass regressions, and no other verdict changes. Profile totals and
case-by-case transitions are in `docs/research/isempty-before-after.md`. Independent review passed,
the owner accepted Option A, and the PR was merged. PR CI passed in run
[39166838346](https://github.com/rezanid/Power-Fx-Ts/actions/runs/39166838346); CI on the merge commit
passed in run [39167949555](https://github.com/rezanid/Power-Fx-Ts/actions/runs/39167949555).

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
`isempty-before-after.md`, `isblankorerror-before-after.md`, `empty-text-probes/`, `isempty-probes/`,
`isblankorerror-probes/`, `dropcolumns-probes/`, `dropcolumns-before-after.md`,
`showcolumns-probes/`, `showcolumns-before-after.md`, `renamecolumns-probes/`,
`renamecolumns-before-after.md`,
`powerfx-coverage-inventory.md`); `packages/test-suite/reports/`.

## Most recently merged milestone: scalar text basics

- Scope and decision: ADR 0016; `docs/milestones/0016-scalar-text-basics-milestone-spec.md`.
- Baseline: `767321b122080991929dde50382d663dc306ac17`; PR #20 is merged; upstream pin unchanged.
- Implemented scalar overloads for `Len`, `Lower`, and `Upper`, including float/decimal `Len`
  return types, existing scalar-to-Text coercions, explicit unsupported table calls, and a frozen
  en-US simple-case table. Table overloads, Text formatting, other text functions, and new types
  remain excluded.
- Reference probes and map generator/verification commands are documented in
  `docs/research/scalar-text-probes/README.md`. The table was verified against en-US `TextInfo`
  for all Unicode scalar values.
- Candidate compat totals: float 2299 / 1 / 46 / 12613; decimal 2831 / 1 / 56 / 13285. Per-case
  comparison shows 71 and 73 unsupported-to-pass transitions respectively and zero
  pass-to-non-pass regressions; see `docs/research/scalar-text-before-after.md`.
- Local build, lint, formatting, all 1,295 tests, both compatibility profiles, and exhaustive casing
  verification passed. Scalar-text implementation is part of main at the DropColumns baseline
  `fc59733cd2e562a1c93b673eed46fd4449a66ba8`.

## Most recently merged milestone: DropColumns

- Scope and decision: ADR 0017; `docs/milestones/0017-dropcolumns-milestone-spec.md`.
- Baseline: `fc59733cd2e562a1c93b673eed46fd4449a66ba8`; upstream pin unchanged.
- Supports static Record/Table sources. PowerFxV1 column-name identifiers are captured from syntax,
  not evaluated or resolved as variables. Output schemas and values preserve retained fields; all
  table rows, their order, and recursive immutability are preserved. Blank/Error values and rows
  pass through; projection checks budget and cancellation per row.
- Pre-implementation reference inputs and float/decimal outputs are in
  `packages/engine/test/fixtures/dropcolumns-probe.*.tsv`; pinned source paths and generation
  commands are in `docs/research/dropcolumns-probes/README.md`.
- Both profiles have 15 `unsupported` → `pass` transitions, zero pass-to-non-pass regressions, and
  no other verdict changes. Totals and per-case comparison are in
  `docs/research/dropcolumns-before-after.md`.
- PR #21 final head `8a0094ba0f9ac9fbec650886aebe22cc11c6fd2d` merged as
  `e2d4624f0ab599745c23a0548622811cb8e59748`. PR CI passed in run
  [41330953195](https://github.com/rezanid/Power-Fx-Ts/actions/runs/41330953195).

## Most recently merged milestone: ShowColumns

- Scope and decision: ADR 0018; `docs/milestones/0018-showcolumns-milestone-spec.md`.
- Baseline: `e2d4624f0ab599745c23a0548622811cb8e59748`; upstream pin unchanged.
- Supports static Record/Table projection with PowerFxV1 bare and escaped identifiers, captured
  from syntax rather than resolved as variables. Output fields follow canonical ordinal name order,
  independent of argument order; direct reference probes separately record type-field order, runtime
  field enumeration and serialized output.
- Duplicate names preserve the reference warning severity and also produce invalid-function-argument
  error; the check remains invalid. Blank/Error propagation, Blank/Error rows, empty tables,
  immutability, and per-row budget/cancellation are covered.
- Pre-implementation probes are in `packages/engine/test/fixtures/showcolumns-*.tsv`; sources and
  generation commands are in `docs/research/showcolumns-probes/README.md`.
- Both profiles have 17 `unsupported` → `pass` transitions, zero regressions, and no other verdict
  changes; see `docs/research/showcolumns-before-after.md`.
- PR #22 merged at `fbbb6c786aba882479806c2e0c36150cf451b156`; its final head is
  `c7ed36da01e1098c4ae41acb333e9bc5aa92d122`.

## Current approved milestone: RenameColumns

- Scope and decision: ADR 0019; `docs/milestones/0019-renamecolumns-milestone-spec.md`.
- Baseline: `fbbb6c786aba882479806c2e0c36150cf451b156`; upstream pin unchanged.
- Supports static Record/Table values with syntax-only PowerFxV1 old/new name identifiers. Rename
  pairs apply simultaneously against the original schema; no-op rename is valid and output fields
  use canonical ordinal order.
- Blank/Error source propagation, Blank/Error rows, retained field errors, empty tables,
  immutability and per-row budget/cancellation are covered.
- The pinned reference checks repeated old-name calls with a preceding no-op as successful but its
  interpreter throws a duplicate-key exception. The approved deviation rejects them at bind time;
  separate reference fixtures retain check success and runtime exception evidence, and these cases
  are not claimed as parity.
- Pre-implementation probes and generation commands are in
  `docs/research/renamecolumns-probes/`; per-case compatibility evidence is in
  `docs/research/renamecolumns-before-after.md`.
- Both profiles have 26 `unsupported` → `pass` transitions, zero regressions, and no other verdict
  changes.
- Draft PR and final-commit CI remain pending; do not merge or begin another milestone.

## Next

No subsequent milestone has been selected or accepted. The remaining candidates in
`docs/research/powerfx-coverage-inventory.md` are proposals only; do not start another milestone
without owner approval.
