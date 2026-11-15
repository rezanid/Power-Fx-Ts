# Scalar rounding compatibility evidence

Baseline: `c32a6ebe56369867f89eb7613fb72b542289af92` (merged Abs/Int/Trunc, PR #27).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`. PowerFxV1, en-US, UTC.
Candidate adds complete scalar Round, RoundDown and RoundUp; RoundDown uses unchanged backend.trunc.

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes                 |
| ------------ | ----------------------------------------: | -----------------------------------------: | ----------------------- |
| `v1-float`   |                   2,617 / 1 / 46 / 12,295 |                    2,869 / 1 / 46 / 12,043 | 252 unsupported to pass |
| `v1-decimal` |                   3,167 / 1 / 56 / 12,949 |                    3,468 / 1 / 56 / 12,648 | 301 unsupported to pass |

Every applicable case was compared with saved baseline TSVs captured before implementation:
14,959 float and 16,173 decimal cases from the pinned 22,047-case corpus. Case sets are identical.
There are **zero pass-to-non-pass regressions and no other verdict changes**.
All 553 transitions are committed in
[scalar-rounding-before-after.cases.tsv](scalar-rounding-before-after.cases.tsv).
The sole existing Text_ExcelCompat_PowerFxV1Compat.txt:13 failure is unchanged.

Each profile gains Round.txt 72, RoundDown.txt 71, RoundUp.txt 68 and mathfuncs.txt 27 cases.
Other gains are compositions in DecimalMathFuncs files (float 12, decimal 36), FloatLarge.txt
(float 2) and DecimalDotnetRuntime.txt (decimal 27). Table overloads remain unsupported.
These corpus outcomes are not language-completeness or effort percentages.

## Verification

Both profiles replay 131 pre-implementation reference fixtures committed in `a7d6a28`.
The focused suite includes 276 tests: exact types/results/diagnostics, signed-zero observations,
paired RoundDown/Trunc boundaries, explicit coercion IR, custom opaque dispatch and failure handling,
exact Decimal operands with toNumber disabled, frozen values/Errors and eager budgets/cancellation.
The existing 228 scalar Abs/Int/Trunc tests remain unchanged.

A supplementary read-only differential experiment compared 2,240 formulas per profile:
16 Float operands across 17 precision boundaries and four operations (Round, RoundDown, RoundUp,
Trunc); eight Decimal edge operands across 11 precisions/four operations; and 200 seeded
96-bit Decimal operands (Python Random seed 23, random scale 0..28, each operation with random
precision -29..29). All numeric values agreed exactly, preserving Float signed zero and normalizing
insignificant Decimal trailing zeros. This is supplementary sampling, not exhaustive proof or a
replacement for committed fixtures and corpus verdicts.

On 2026-11-06 (UTC), build, all **2,381 tests** (276 focused scalar-rounding tests), lint and
formatting passed. Both compatibility profiles completed with the unchanged known failure;
final per-case comparison confirmed identical case sets and exactly the 553 gains above.
Both reference fixture outputs regenerate exactly. README/name counts reconcile with the
generated registry inventory (14 implemented + 17 partial + 113 missing + 1 excluded = 145).
Changed-document relative links and diff whitespace checks passed.
Exact final-head CI evidence will be recorded on the draft PR rather than causing another source commit.
Reference runtime: .NET 10.0.14/macOS Arm64; no universal runtime parity claim.
Commands/sources: [scalar-rounding-probes](scalar-rounding-probes/README.md).
Numeric boundaries/migration: [ADR 0023](../adr/0023-scalar-rounding.md).

Baseline TSVs are retained in this session's files/scalar-rounding-baseline/; candidate TSVs are
generated under packages/test-suite/reports/. Reproduce by running both compatibility commands
from AGENTS.md on the exact baseline and candidate, then comparing verdicts by profile/file/line.
Require identical case sets; aggregate totals alone are insufficient.
