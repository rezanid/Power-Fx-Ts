# Numeric text parsing: case-level before/after (PR #8 `main` 9833ddd vs this branch)

Same runner (`pnpm --filter @powerfx-ts/test-suite compat <profile>`, per-case TSV); identical case
keys on both sides (14,959 float, 16,173 decimal).

| Transition                 | `v1-float` | `v1-decimal` |
| -------------------------- | ---------: | -----------: |
| pass -> fail / unsupported |      **0** |        **0** |
| fail -> pass               |        231 |          230 |
| unsupported -> pass        |        652 |          278 |
| unsupported -> fail        |          0 |            5 |

Totals: float pass 1,263 -> 2,146, fail 233 -> 2, unsupported 13,417 -> 12,765.
Decimal pass 2,121 -> 2,629, fail 262 -> 37, unsupported 13,734 -> 13,451.

## Newly exposed (unsupported -> fail), decimal only

Previously masked because the text parse was unsupported; all are pre-existing gaps, not regressions:
`DecimalMathFuncs_NumberIsFloatDisabled.txt:381`, `..._DVDecimal.txt:412`, `ValueFuncs_NumberIsDecimal.txt:85,97`
(missing cascaded diagnostics "Numeric value is too large"), and `ValueFuncs_NumberIsDecimal.txt:100`
(error-table serialization: we return a single error instead of a two-row error table).

## Remaining failures

Float (2): `ValueFuncs_NumberIsFloat.txt:53` (error table), `Text_ExcelCompat_PowerFxV1Compat.txt:13`.
Decimal (37): cascaded out-of-range-literal diagnostics (`OpMatrix_*_Decimal`, `DecimalOverflow`,
`DecimalMathFuncs_*`), error-table cases in `ValueFuncs_NumberIsDecimal`, plus the Excel-compat case.

Vector-level evidence: `packages/engine/test/fixtures/numeric-text-vectors.json` (reference output,
.NET 10.0.9) replayed in both profiles with zero mismatches.
