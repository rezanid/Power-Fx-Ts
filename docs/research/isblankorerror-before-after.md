# IsBlankOrError compatibility evidence

Reference: Microsoft Power Fx `df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`,
en-US, UTC. Baseline: `78bd2f7452aa6f14302aaa2b64124b7a5a6259aa` (PR #17 merge), on branch
`rezanid-milestone-isblankorerror`. Both profiles ran against all 22,047 corpus cases.

## Profile totals

| Profile      | Baseline pass / fail / skip / unsupported | After pass / fail / skip / unsupported | Pass-to-non-pass |
| ------------ | ----------------------------------------- | -------------------------------------- | ---------------: |
| `v1-float`   | 2225 / 1 / 46 / 12687                     | 2228 / 1 / 46 / 12684                  |                0 |
| `v1-decimal` | 2755 / 1 / 56 / 13361                     | 2758 / 1 / 56 / 13358                  |                0 |

Both profile comparisons found exactly three changes, all `unsupported` → `pass` in the
`IsBlankOrError.txt` corpus:

| Corpus line | Reference case                           | Reference result |
| ----------: | ---------------------------------------- | ---------------- |
|           3 | `IsBlankOrError(If(1 < 0, "hello"))`     | `true`           |
|           6 | `IsBlankOrError("hello")`                | `false`          |
|           9 | `IsBlankOrError(If(1 / 0 < 2, "hello"))` | `true`           |

There are no added or removed corpus cases and no other verdict changes. The single pre-existing
`Text()` failure in each profile is unchanged. Generated probes and TypeScript replay tests add
reference-backed coverage beyond these three corpus cases; see
`docs/research/isblankorerror-probes/`.
