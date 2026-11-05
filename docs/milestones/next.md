# Next milestone

`AddColumns` is merged in PR #24. The FirstN / Last / LastN static-table scope is approved from
`a5be0240fb52dca0a9efdb17a8e507a221bf2f08` and implemented; independent review is pending.
The owner accepted the deterministic saturating conversion after reviewing boundary probes.
It matches the measured .NET 10.0.14/macOS Arm64 runtime, not every older runtime.
See [ADR 0021](../adr/0021-table-selection.md), the
[milestone spec](0021-table-selection-milestone-spec.md) and
[`table-selection-probes`](../research/table-selection-probes/README.md).
No subsequent milestone is selected. The other bounded candidates in
`docs/research/powerfx-coverage-inventory.md` remain proposals, not authorization to begin work.
