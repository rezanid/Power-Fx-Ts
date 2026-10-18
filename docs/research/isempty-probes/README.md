# IsEmpty reference probes

`expressions.txt` with `reference.v1-{float,decimal}.tsv` (harness `probe`). Rows needing all-Blank table
literals are **excluded** from required-pass fixtures because the binder reports them unsupported: `IsEmpty([Blank()])`
(also corpus lines 53 and 56). `Table(Blank())` and `Table({a:Blank()})` are supported and in scope.
`IsEmpty(1/0)` is a compile-error probe, not a runtime Error-propagation test.

`additional-expressions.txt` and `additional-reference.v1-{float,decimal}.tsv` record the supplemental
pinned-reference probes for Error-valued table arguments through `If`/`With`, diagnostic recovery, and
additional reachable table cases. The `packages/engine/test/fixtures/isempty-probe.*.tsv` fixtures replay
the required-pass probe set in both profiles; they omit the all-Blank literal case.
