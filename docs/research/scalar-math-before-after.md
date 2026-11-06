# Scalar math compatibility evidence

Baseline: `14f9f31ef03c2bf2c80948a8a7fc889a43be2c94` (merged localization review, PR #26).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`. PowerFxV1, en-US, UTC.
Candidate adds scalar Abs, Int and full scalar Trunc, including optional precision.

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes                 |
| ------------ | ----------------------------------------: | -----------------------------------------: | ----------------------- |
| `v1-float`   |                   2,466 / 1 / 46 / 12,446 |                    2,617 / 1 / 46 / 12,295 | 151 unsupported to pass |
| `v1-decimal` |                   3,002 / 1 / 56 / 13,114 |                    3,167 / 1 / 56 / 12,949 | 165 unsupported to pass |

Every applicable case was compared against saved baseline TSVs captured before implementation:
14,959 float cases and 16,173 decimal cases from the pinned 22,047-case corpus. Case sets are
identical. There are **zero pass-to-non-pass regressions and no other verdict changes**.
All 316 transitions are committed in
[`scalar-math-before-after.cases.tsv`](scalar-math-before-after.cases.tsv).
The sole pre-existing Text_ExcelCompat_PowerFxV1Compat.txt:13 failure is unchanged.

Each profile gains 19 Abs.txt, 19 Int.txt and 78 Trunc.txt cases. Other gains are compositions and
numeric tests, including Decimal runtime tests in decimal mode; the TSV itemizes them without
treating them as independent feature completion. All table overloads remain excluded.
Corpus outcomes are not language-completeness or effort percentages.

## Verification

On 2026-11-05 (UTC), build, all **2,105 tests** (228 focused scalar-math tests), lint and formatting
passed. Both profile runs completed with the unchanged known failure noted above; full per-case
comparison found only the gains listed here. Relative documentation links and the README/name
counts were checked against the generated registry inventory.

Reference fixtures were generated and committed in `bb8b4fb` before implementation. Both profiles
replay all 105 fixtures, including explicit Text observations of signed zero, Decimal extrema,
Float scaling boundaries and precision conversions at signed Int32 limits. The focused suite also
covers custom opaque backend values, exact Decimal operands with Float conversion disabled,
frozen results/Errors, budgets, cancellation, unsupported tables and nonfinite errors.
Nested diagnostic probes were committed in `8617cfb` before the binder recovery follow-up.

An additional read-only differential experiment tested 654 formulas per profile: all precisions
-16 through 17 on six Float scaling operands, plus 150 seeded Decimal operands with Abs, Int and
Trunc (Python Random seed 222). All numeric values agreed exactly after normalizing insignificant
Decimal trailing zeros; Floats were compared by numeric value with signed zero preserved, not
printed notation. This is supplementary sampling, not an exhaustive proof.

The checked-in harness builds (expected SourceLink warnings with source-control queries disabled);
both fixture outputs regenerate exactly on .NET 10.0.14/macOS Arm64. See
[`scalar-math-probes/`](scalar-math-probes/README.md) for sources, runtime and commands, and
[ADR 0022](../adr/0022-scalar-math.md) for precision-clamping and custom-backend details.

Baseline TSVs are retained in this session's `files/scalar-math-baseline/`; candidate TSVs are
generated under `packages/test-suite/reports/`. To reproduce, run the two compatibility commands
from AGENTS.md on the exact baseline engine sources and candidate, then compare verdicts keyed
by profile and corpus-file/line. Keep case sets identical; aggregate totals alone are insufficient.
