# `ShowColumns` compatibility evidence

Baseline: main merge commit `e2d4624f0ab599745c23a0548622811cb8e59748` (DropColumns merged).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`, en-US, UTC. Candidate
includes static Record/Table `ShowColumns`.

Both compatibility runs cover the pinned 22,047-case corpus. Profile applicability differs.

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes               |
| ------------ | ----------------------------------------: | -----------------------------------------: | --------------------- |
| `v1-float`   |                   2,314 / 1 / 46 / 12,598 |                    2,331 / 1 / 46 / 12,581 | 17 unsupported → pass |
| `v1-decimal` |                   2,846 / 1 / 56 / 13,270 |                    2,863 / 1 / 56 / 13,253 | 17 unsupported → pass |

Per-case transitions are in
[`showcolumns-before-after.cases.tsv`](showcolumns-before-after.cases.tsv). Every transition is in
`ShowColumns.txt`; there are no other verdict changes and zero pass-to-non-pass regressions. The
existing `Text_ExcelCompat_PowerFxV1Compat.txt:13` failure remains unchanged in both profiles.
Host/display-name cases in `ShowColumns_WithMutationSetup.txt` remain outside the supported slice.

Pre-implementation reference inputs and outputs are in
[`showcolumns-probes/README.md`](showcolumns-probes/README.md) and
`packages/engine/test/fixtures/showcolumns-*.tsv`. The order probe records type fields, runtime
fields, and serialized output independently for nonalphabetically authored source fields. Duplicate
name evidence includes both warning severity and the invalid-arguments error.
