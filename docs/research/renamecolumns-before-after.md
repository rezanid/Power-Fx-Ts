# `RenameColumns` compatibility evidence

Baseline: merged ShowColumns commit `fbbb6c786aba882479806c2e0c36150cf451b156`. Upstream:
`df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`, en-US, UTC. Candidate includes
static Record/Table `RenameColumns`.

Both compatibility runs cover the pinned 22,047-case corpus; profile applicability differs.

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes               |
| ------------ | ----------------------------------------: | -----------------------------------------: | --------------------- |
| `v1-float`   |                   2,331 / 1 / 46 / 12,581 |                    2,357 / 1 / 46 / 12,555 | 26 unsupported → pass |
| `v1-decimal` |                   2,863 / 1 / 56 / 13,253 |                    2,889 / 1 / 56 / 13,227 | 26 unsupported → pass |

Per-case transitions are in
[`renamecolumns-before-after.cases.tsv`](renamecolumns-before-after.cases.tsv). All 26 changes in
each profile are in `RenameColumns_SupportColumnNamesAsIdentifiers.txt`. There are no other verdict
changes and zero pass-to-non-pass regressions. The existing
`Text_ExcelCompat_PowerFxV1Compat.txt:13` failure remains unchanged.

The explicit repeated-no-op deviation is documented separately in
[`renamecolumns-probes/README.md`](renamecolumns-probes/README.md) and
`packages/engine/test/fixtures/renamecolumns-deviation.*.tsv`. Those probes show upstream `Check`
success followed by an interpreter exception. They are not represented as a compatibility pass or
included in the reported 26 corpus transitions.
