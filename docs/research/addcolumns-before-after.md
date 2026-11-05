# `AddColumns` compatibility evidence

Baseline: merged RenameColumns commit `3d26204f5c970141a449cc596cf7969b6a18aaa9`. Upstream:
`df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`, en-US, UTC. Candidate includes
static Record/Table `AddColumns`.

Both compatibility runs cover the pinned 22,047-case corpus; profile applicability differs.

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes               |
| ------------ | ----------------------------------------: | -----------------------------------------: | --------------------- |
| `v1-float`   |                   2,357 / 1 / 46 / 12,555 |                    2,398 / 1 / 46 / 12,514 | 41 unsupported → pass |
| `v1-decimal` |                   2,889 / 1 / 56 / 13,227 |                    2,934 / 1 / 56 / 13,182 | 45 unsupported → pass |

Per-case transitions are in
[`addcolumns-before-after.cases.tsv`](addcolumns-before-after.cases.tsv). There are no other verdict
changes and zero pass-to-non-pass regressions. The existing
`Text_ExcelCompat_PowerFxV1Compat.txt:13` failure remains unchanged.

Most transitions are in `AddColumns_SupportColumnNamesAsIdentifiers.txt`; the complete TSV also
records newly supported cases in other table/column-operation corpus files. These counts describe
the corpus only, not a fraction of Power Fx semantics or implementation effort.
