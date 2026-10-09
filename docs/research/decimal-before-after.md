# Decimal milestone: case-level before/after (PR #8 vs `main` f1bed33)

Pinned upstream `df4ceba5e08220db670c25afead342ce699c50b5`. Both sides were run with the same runner
(`pnpm --filter @powerfx-ts/test-suite compat <profile>`, which now also writes
`reports/<profile>.engine.cases.tsv`, one `file:line<TAB>outcome` row per executed case; git-ignored).
`main` was measured in a temporary worktree with the identical `--cases` patch; the case keys are
identical on both sides (14,959 float, 16,173 decimal).

## Transition matrix (before -> after)

| Transition                 | `v1-float` | `v1-decimal` |
| -------------------------- | ---------: | -----------: |
| pass -> pass               |        826 |            0 |
| pass -> fail / unsupported |      **0** |        **0** |
| fail -> fail               |          1 |            0 |
| skip -> skip               |         46 |           56 |
| unsupported -> pass        |        437 |        2,121 |
| unsupported -> fail        |        232 |          262 |
| unsupported -> unsupported |     13,417 |       13,734 |

No previously passing case regressed. Every new failure was `unsupported` before (it was never
executed), so these are newly exposed gaps, not regressions.

## Newly exposed failures, classified

| Class                                                                                               | float | decimal |
| --------------------------------------------------------------------------------------------------- | ----: | ------: |
| Culture-aware `Decimal(text)` parsing (228 in `Decimal.txt` + `Float.txt`, a few in `ValueFuncs_*`) |  228+ |    228+ |
| Missing cascaded diagnostics for out-of-range literals (`OpMatrix_*_Decimal` etc.)                  |     1 |      30 |
| Other value mismatches (`DecimalOverflow`, `DecimalMathFuncs_*`, `ValueFuncs_*`)                    |     — |   small |
| Error-table serialization (`ValueFuncs_NumberIsFloat.txt:53`)                                       |     1 |       — |
| Pre-existing (`Text_ExcelCompat_PowerFxV1Compat.txt:13`)                                            |     1 |       1 |

Counts are by file: float 233 = 114 `Decimal.txt` + 114 `Float.txt` + 5 elsewhere; decimal 262 includes
the same 228 plus the OpMatrix diagnostics and a few value cases. Exact lists are in the
git-ignored `reports/*.engine.json` after running compat.

## Comparison-rule change

The stricter Decimal comparison (no float tolerance for Decimal results) changed **no** verdict:
`v1-decimal` is pass 2,121 / fail 262 before and after.
