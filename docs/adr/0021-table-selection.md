# ADR 0021: FirstN, Last and LastN for static tables

Status: **accepted, implemented and merged in PR #25** at
`3f6d86bf3f597a38f190c94518aed69b4e0b2d92`. Baseline:
`a5be0240fb52dca0a9efdb17a8e507a221bf2f08` (merged AddColumns, PR #24). Upstream:
`df4ceba5e08220db670c25afead342ce699c50b5`.

## Decision

Implement `Last(table)`, `FirstN(table, count)` and `LastN(table, count)` for existing statically
supported tables. Under PowerFxV1, `FirstLastNRequiresSecondArguments` is enabled: N counts are
required, even though the legacy profile can default them to 1.

- Last returns the source row Record type and the final row; an empty table returns Blank.
  Last of bare Blank has an empty Record type and returns Blank.
- The N functions retain the complete source Table type, including fields whose only non-Blank
  values occur in unselected rows. Bare Blank is also accepted and retains its Blank type.
- Evaluate source once, then count once outside row scope. Typed Blank sources propagate only
  after count evaluation and error handling. Combine source and count Errors in argument order,
  retaining repeated errors.
- Bind counts to Float in both numeric profiles with explicit scalar coercions. Boolean becomes
  0/1; Blank and empty Text become zero; other Text uses existing en-US numeric parsing.
  Invalid numeric Text produces InvalidArgument; Record/Table count arguments are invalid formulas.
  Typed runtime Blank counts also become zero.
- Preserve source row order, selected Blank/Error rows, and retained field errors. LastN selects
  a suffix, never a reversal. Neither N function promotes unselected row/field Errors.
- Selection does not defer source evaluation. Existing table literals, Filter and AddColumns
  evaluate normally before selection, even for zero count. No row expression is reevaluated.
- Results are recursively immutable. Share already frozen rows instead of cloning records.
- FirstN checks cancellation and charges budget for each selected prefix row. LastN traverses and
  checks every source row, even with zero count, without first copying all rows. Last uses direct
  final-row access and charges one row step when nonempty. Normal evaluated-node checks still apply.

## Accepted deterministic count conversion

The owner approved this rule after both-profile boundary probes, before implementation:

1. Perform explicit Float coercion, including the existing .NET-compatible Decimal-to-Float
   conversion. Never truncate the original Decimal or parse Decimal text through JS Number.
2. Reject/propagate nonfinite numeric and coercion errors; NaN must never become a valid count.
3. Truncate toward zero, clamp to `[-2147483648, 2147483647]`, then treat nonpositive counts as zero.
4. Select no more than the available rows. Do not use JavaScript bitwise wrapping.

Verified against **.NET 10.0.14, macOS Arm64**, with SDK 10.0.403. The harness targets net8.0
but rolls forward to that installed runtime. Upstream uses an unchecked Float-to-Int32 cast;
older x86/x64 runtimes can produce Int32.MinValue for positive overflow instead of saturation.
This deterministic compatibility rule intentionally does not emulate that older overflow behavior.
It is **not universal .NET parity**, and corpus verdicts are not weakened to accommodate it.

For example, Decimal `"1.9999999999999997"` converts to Float `1.9999999999999996` and selects one
row; Decimal `"1.9999999999999998"` converts to Float `2` and selects two. Positive maximum finite
Float selects all available rows (up to Int32.MaxValue); its negative counterpart selects none.

## Ordering and inherited limitation

Reference probes independently observe schema order, runtime field enumeration and serialization,
using fields deliberately written `z,a,m`. The reference enumerates them as `a,m,z`.
The pre-existing TypeScript table constructor retains runtime field insertion order `z,a,m` for
this input, while the schema and compatibility serialization use `a,m,z`. These selectors preserve
the source runtime records without introducing a reorder. Tests record that existing distinction
explicitly; they do not claim direct field-enumeration parity or refactor record construction.

## Reuse and exclusions

Reuse First's table checks, structural schemas/conformance, scalar coercion nodes, numeric backends,
frozen values, ordered Error combination, and existing evaluator safety checks. First's behavior
is unchanged.

Dynamic/untyped overloads, lazy/paged providers, data sources/delegation, mutation, legacy profile
configuration, other functions and unrelated refactoring remain out of scope.

## Evidence

Reference inputs and generated outputs were committed before implementation. Exact upstream source
paths, environment, commands, cast observations and ordering evidence are in
[`table-selection-probes/`](../research/table-selection-probes/README.md).
Per-case results are in [`table-selection-before-after.md`](../research/table-selection-before-after.md).
