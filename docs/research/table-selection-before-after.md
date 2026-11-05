# FirstN / Last / LastN compatibility evidence

Baseline: merged AddColumns `a5be0240fb52dca0a9efdb17a8e507a221bf2f08`. Upstream:
`df4ceba5e08220db670c25afead342ce699c50b5`, PowerFxV1, en-US, UTC.
Candidate includes FirstN, Last and LastN on statically supported tables.

Both reports cover the pinned 22,047-case corpus. Every applicable case was compared with the
baseline engine sources before implementation (14,959 float cases; 16,173 decimal cases).

| Profile      | Baseline pass / fail / skip / unsupported | Candidate pass / fail / skip / unsupported | Changes                |
| ------------ | ----------------------------------------: | -----------------------------------------: | ---------------------- |
| `v1-float`   |                   2,398 / 1 / 46 / 12,514 |                    2,466 / 1 / 46 / 12,446 | 68 unsupported to pass |
| `v1-decimal` |                   2,934 / 1 / 56 / 13,182 |                    3,002 / 1 / 56 / 13,114 | 68 unsupported to pass |

The complete transitions are committed in
[`table-selection-before-after.cases.tsv`](table-selection-before-after.cases.tsv).
There are **zero pass-to-non-pass regressions and no other verdict changes**.
The existing `Text_ExcelCompat_PowerFxV1Compat.txt:13` failure is unchanged.

In each profile, 45 gains occur in the FirstLast/FirstLastN corpus files (including V1 rules and
required-count diagnostics). The other 23 gains are compositions in coercion, column-operation,
filtering, error, IsEmpty and CountRows files; they are itemized rather than assumed independent
features. These counts are corpus outcomes, not language-completeness or effort percentages.

The owner-approved overflow rule is verified against .NET 10.0.14 on macOS Arm64 and documented
separately in [ADR 0021](../adr/0021-table-selection.md) and
[reference evidence](table-selection-probes/README.md). Older runtime overflow behavior is not
claimed as parity. The inherited difference between TypeScript source runtime field insertion
order and reference runtime field enumeration is also recorded there; source records are preserved.
No compatibility comparison rules have changed.

## Verification

On 2026-11-05 (UTC), build, all **1,877 tests**, lint, formatting and both compatibility runs passed
their required checks (the compatibility reports retain the one known failure described above).
The focused selection suite accounts for 370 tests across both profiles. The checked-in reference
harness builds, and all ten boundary/cast/semantic/diagnostic/ordering outputs regenerate byte-for-byte on the
recorded runtime; only expected SourceLink warnings occur with source-control queries disabled.
Relative Markdown links and the name-count reconciliation against the generated registry were checked.

Pre-implementation reference evidence was committed in `4dd5442` and `5097de1`; combined diagnostic
probes were committed in `20e52ed` before the binder follow-up. Baseline per-case
TSVs were captured before semantic implementation in this session's
`files/table-selection-baseline/`; candidate TSVs are generated under
`packages/test-suite/reports/`. Reproduce the baseline using engine sources from the exact baseline
SHA and the pinned corpus, run both profile commands from `AGENTS.md`, then compare verdicts keyed
by profile and corpus-file/line. Keep case sets identical; do not compare aggregate counts alone.
