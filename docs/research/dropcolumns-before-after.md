# `DropColumns` compatibility evidence

Baseline: main commit `fc59733cd2e562a1c93b673eed46fd4449a66ba8` (after merged scalar text basics).
Upstream: `df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`, en-US, UTC. Candidate
includes the approved static Record/Table `DropColumns` slice.

Both compatibility runs cover the pinned 22,047-case corpus. Profile applicability differs.

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes               |
| ------------ | ----------------------------------------: | -----------------------------------------: | --------------------- |
| `v1-float`   |                   2,299 / 1 / 46 / 12,613 |                    2,314 / 1 / 46 / 12,598 | 15 unsupported → pass |
| `v1-decimal` |                   2,831 / 1 / 56 / 13,285 |                    2,846 / 1 / 56 / 13,270 | 15 unsupported → pass |

Per-case transitions are recorded in
[`dropcolumns-before-after.cases.tsv`](dropcolumns-before-after.cases.tsv). All 15 transitions in
each profile are in `DropColumns_SupportColumnNamesAsIdentifiers.txt`; there are no other verdict
changes and zero pass-to-non-pass regressions. The existing `Text_ExcelCompat_PowerFxV1Compat.txt:13`
failure remains unchanged in both profiles.

The separate generated probes and their pinned-source paths are documented in
[`dropcolumns-probes/README.md`](dropcolumns-probes/README.md). The probe fixtures replay against both
numeric profiles, including identifier-vs-variable binding, schema/value results, diagnostics,
Blank/Error propagation, and Blank/Error rows. Focused evaluator tests additionally cover immutable
projection, row order, per-row budget charging and cancellation.
