# IsEmpty compatibility evidence

Reference: Microsoft Power Fx `df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`,
en-US, UTC. Baseline: `984a61b` (`main` after merged PR #15), built and compared in an isolated
worktree. The implementation uses `NumberIsFloat` for `v1-float` and Decimal for `v1-decimal`.
Both per-case comparisons covered all 22,047 corpus cases.

## Profile totals

| Profile      | Baseline pass / fail / skip / unsupported | After pass / fail / skip / unsupported | Pass-to-non-pass |
| ------------ | ----------------------------------------- | -------------------------------------- | ---------------: |
| `v1-float`   | 2207 / 1 / 46 / 12705                     | 2225 / 1 / 46 / 12687                  |                0 |
| `v1-decimal` | 2737 / 1 / 56 / 13379                     | 2755 / 1 / 56 / 13361                  |                0 |

There were exactly 18 verdict transitions in each profile; every one was `unsupported` → `pass`
in `IsEmpty.txt`. No other case changed verdict.

## All verdict transitions

| Corpus line | Case                                     | Why it is reachable                                 |
| ----------: | ---------------------------------------- | --------------------------------------------------- |
|           5 | `IsEmpty([1234])`                        | One-row numeric table literal                       |
|           8 | `IsEmpty([1, 2, 3, 4, 5])`               | Multi-row numeric table literal                     |
|          14 | `IsEmpty([false])`                       | Boolean row                                         |
|          17 | `IsEmpty(["Hello"])`                     | Text row                                            |
|          23 | `IsEmpty([""])`                          | Empty Text is still a row                           |
|          26 | `IsEmpty(Table({a:"1"}, ...))`           | `Table(...)` record rows                            |
|          44 | `IsEmpty([])`                            | Empty table literal                                 |
|          47 | `IsEmpty(Blank())`                       | Typed Blank argument                                |
|          50 | `IsEmpty(If(1<0,[1,2,3]))`               | Table-typed `If` produces Blank                     |
|          59 | `IsEmpty(Table(Blank()))`                | `Table(...)` preserves a Blank row                  |
|          62 | `IsEmpty(Table({a:Blank()}))`            | Record row with Blank field                         |
|          65 | `IsEmpty(Table({a:Blank()}, ...))`       | Multiple record rows with Blank fields              |
|          74 | `IsEmpty([1/0])`                         | Error-valued cell still occupies a row              |
|          84 | `IsEmpty(Filter([1, 2, 3], Value > 10))` | Supported `Filter` returns no rows                  |
|         128 | `IsEmpty("")`                            | Precise Text-vs-Table diagnostic                    |
|         131 | `IsEmpty({})`                            | Precise Record-vs-Table diagnostic                  |
|         134 | `IsEmpty(0)`                             | Precise Number-vs-Table diagnostic in both profiles |
|         137 | `IsEmpty(false)`                         | Precise Boolean-vs-Table diagnostic                 |

The corpus still has one unrelated `Text()` failure in each profile; its verdict did not change.

## Exclusions retained

All-Blank table literals remain unsupported at lines 53 and 56; the binder's existing
“Table of only Blank values” limitation is unchanged. The other 14 excluded cases remain
unsupported because they depend on unimplemented behavior: Date/Time/DateTime at lines 32, 35,
38, 96, 100, 104, and 108; `LastN` at 68; `Sqrt` at 77; `Len` at 88 and 92; and `ParseJSON`/
untyped objects at 118, 121, and 124. Thus all 16 reviewed exclusions retain their baseline
verdict in both profiles.

## Reference probes

The committed probe set in `docs/research/isempty-probes/` is based on the harness at the pinned
upstream revision. Its supplemental cases verify `Table({a:Blank()})`, the reachable numeric
`Filter`, Error-valued table arguments through `If` and `With`, and `If(IsEmpty(0), 1, 2)`
diagnostic recovery. Both numeric modes report the invalid argument as `Number`, and both propagate
`Error(Div0)` for the table-typed Error results. The required-pass engine fixtures omit the
all-Blank `[Blank()]` reference row and explicitly assert that this unsupported case remains
unsupported.
