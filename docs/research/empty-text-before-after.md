# Empty-text coercion: before/after evidence

Baseline `main` `f9df8bb`; implementation commit `f0c7ea9` (binder + tests; later commits are docs only).
Pin `df4ceba5`. Baseline per-case artifacts were generated in an isolated detached worktree at `f9df8bb`
(`/tmp/es/base-*.tsv`, local only) and compared with the changed tree
(`packages/test-suite/reports/<profile>.engine.cases.tsv`, git-ignored; `/tmp/es/post-*.tsv`).

| Profile      | Before (pass / fail / skip / unsupported) | After                 | Verdict transitions |
| ------------ | ----------------------------------------- | --------------------- | ------------------- |
| `v1-float`   | 2207 / 1 / 46 / 12705                     | 2207 / 1 / 46 / 12705 | 0 (of 14959 cases)  |
| `v1-decimal` | 2737 / 1 / 56 / 13379                     | 2737 / 1 / 56 / 13379 | 0 (of 16173 cases)  |

No pass-to-non-pass regressions and no fixes: no corpus case depends on this behavior, and the committed
`*.engine.md` reports are unchanged. Exact Decimal comparison, upstream float tolerance and the separate
strict-diagnostic reporting are untouched (no runner changes).

Reference probes (the compatibility evidence), engine versus reference, per profile:

| Set                                            | Expressions | Differing before | Differing after |
| ---------------------------------------------- | ----------: | ---------------: | --------------: |
| `If`/array/`With`/`Filter` (`expressions.txt`) |          45 |               25 |               0 |
| `Table(...)`, nested tables (`table-*`)        |          28 |               17 |               0 |
| consumer guards (`consumers.*`)                |           9 |     not compared |    0 (replayed) |

Checks at `f0c7ea9`: build, lint, format and 1109 tests passed locally.
