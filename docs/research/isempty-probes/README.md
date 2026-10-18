# IsEmpty reference probes

`expressions.txt` with `reference.v1-{float,decimal}.tsv` (harness `probe`). Rows needing all-Blank table
literals are **excluded** from required-pass fixtures because the binder reports them unsupported: `IsEmpty([Blank()])`
(also corpus lines 53 and 56). `Table(Blank())` is supported and in scope. `IsEmpty(1/0)` is a compile-error
probe, not a runtime Error-propagation test.
