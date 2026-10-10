# Coalesce: before/after evidence

Baseline: `main` `820c9be` (artifacts `/tmp/cf/base-*.tsv`, local only). Pin `df4ceba5`.
Compat runs executed on the working tree whose source is identical to PR head commit `e97aed4`; the
final PR head `d4df60d` only added tests/docs (`git diff e97aed4 d4df60d` touches only
`coalesce.test.ts` and `docs/agent-handoff.md`). Merge commit `f9df8bb`.
Per-case comparison of `packages/test-suite/reports/<profile>.engine.cases.tsv` (git-ignored).

| Profile      | Before (pass / fail / skip / unsupported) | After                 | Pass-to-non-pass | Other verdict changes |
| ------------ | ----------------------------------------- | --------------------- | ---------------- | --------------------- |
| `v1-float`   | 2147 / 1 / 46 / 12765                     | 2207 / 1 / 46 / 12705 | 0                | 60 unsupported→pass   |
| `v1-decimal` | 2665 / 1 / 56 / 13451                     | 2737 / 1 / 56 / 13379 | 0                | 72 unsupported→pass   |

Fixed cases by file: `Coalesce.txt` 42 and `Coalesce_V1Compat.txt` 5 in both profiles (the 47 in-scope
cases); `LazyEvaluation_ShortCircuit.txt` 11 and `Acumatica.txt` 2 (both profiles) and
`DecimalNonMathFuncs.txt` 6 and `DecimalNonMathFuncs_DVDecimal.txt` 6 (decimal only) pass because they
use `Coalesce` for non-Coalesce purposes. No new failures, no regressions; the one failure per profile
is unchanged (`Text_ExcelCompat_PowerFxV1Compat.txt:13`). The 35 excluded cases remain `unsupported`.

Differential tests: 240 reference probes × 2 modes in `packages/engine/test/coalesce.test.ts`, plus
laziness/budget, cancellation, conformance-budget and frozen-result tests.

Finding: `If`/array literals turn `""` into `0`/`false` where upstream gives Blank (ADR 0012).
