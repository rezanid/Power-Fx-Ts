# Compat cleanup: before/after (baseline = PR #9 merge `e577eb6`)

| Profile    | Pass (before → after) | Fail (before → after) | Skip | Unsupported |
| ---------- | --------------------- | --------------------- | ---- | ----------- |
| v1-float   | 2146 → 2147           | 2 → 1                 | 46   | 12765       |
| v1-decimal | 2629 → 2665           | 37 → 1                | 56   | 13451       |

Per-case comparison of the committed-baseline `reports/*.engine.cases.tsv` against the new run:
**0 pass→non-pass regressions** and no other verdict changes in either profile.

- v1-float: 1 fail→pass (`ValueFuncs_NumberIsFloat.txt:53`, error table).
- v1-decimal: 36 fail→pass:
  - 34 cascaded literal diagnostics: `DecimalMathFuncs_NumberIsFloatDisabled.txt:381/384/387`,
    `…_DVDecimal.txt:412/415/418`, `DecimalOverflow.txt:10/22`, `OpMatrix_{Eq,Neq,Lt,Leq,Gt,Geq}_Decimal.txt`
    (3 each), `ValueFuncs_NumberIsDecimal.txt:35/38/50/53/85/97/129/141`;
  - 2 error tables: `ValueFuncs_NumberIsDecimal.txt:56/100`.
- Remaining failure (both profiles): `Text_ExcelCompat_PowerFxV1Compat.txt:13` (`Text()` formatting, out
  of scope).

Reproduce: `pnpm --filter @powerfx-ts/test-suite compat v1-float|v1-decimal`, then diff the `.cases.tsv`
(`file:line<TAB>outcome`) against the baseline run on `main`.
