# Next milestone

FirstN / Last / LastN is merged in PR #25; the localization review is merged in PR #26.
Scalar Abs / Int / Trunc merged in PR #27 at `c32a6ebe56369867f89eb7613fb72b542289af92`.
The approved scalar Round / RoundDown / RoundUp milestone is implemented from that baseline;
independent review is pending. All require two arguments. Float epsilon/operation order and
exact Decimal intermediate rounding/underflow are preserved; RoundDown uses unchanged backend.trunc.
New custom-backend methods are round and roundUp. Table/untyped overloads, other math functions,
localization and unrelated refactoring remain excluded.
See [ADR 0023](../adr/0023-scalar-rounding.md), the
[milestone spec](0023-scalar-rounding-milestone-spec.md) and
[`scalar-rounding-probes`](../research/scalar-rounding-probes/README.md).
No subsequent milestone is selected. The other bounded candidates in
`docs/research/powerfx-coverage-inventory.md` remain proposals, not authorization to begin work.
