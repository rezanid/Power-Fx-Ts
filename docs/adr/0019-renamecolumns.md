# ADR 0019: `RenameColumns` for static record/table values

Status: **accepted and implemented; independent review pending**. Baseline:
`fbbb6c786aba882479806c2e0c36150cf451b156`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`.

## Decision

Implement `RenameColumns(source, oldName, newName, ...)` for statically supported Record and Table
values in the PowerFxV1 profile.

- Require at least one old/new pair and an odd total argument count. Both names in each pair are
  bare or escaped PowerFxV1 identifiers taken from syntax, never evaluated or resolved as variables.
- Resolve every old name against the original source schema. Pairs apply simultaneously; a pair does
  not see a preceding pair's rename. Nested calls operate on the result of the inner call.
- Names are case-sensitive. A new name may equal its own old name as a no-op. Missing old names,
  repeated old names, existing-field destination collisions, and repeated destinations are errors.
  Swaps are rejected because destinations may not collide with any original field.
- Emit the result schema and runtime record fields in canonical ordinal name order, independent of
  input schema and pair order. Reference probes record type field order, runtime enumeration, and
  `ToExpression()` serialization independently.
- Propagate typed source Blank/Error. Preserve Blank/Error table rows, errors in retained fields, and
  empty tables with the renamed schema. Return recursively immutable values and check cancellation
  and consume one evaluation step per table row.

## Deliberate reference-runtime deviation

For `RenameColumns({a:1,b:2}, a, a, a, x)` and
`RenameColumns({a:1,b:2}, a, a, a, a)`, the pinned reference `Check` succeeds but evaluation throws
`An item with the same key has already been added. Key: a` while constructing its rename dictionary.
This is captured as separate check and runtime-exception evidence and is not claimed as parity.
Following the approved decision, this implementation rejects any repeated old name, including when
the earlier pair was a no-op, with a repeated-source diagnostic. Tests separately cover a single
no-op, repeated no-ops, and no-op-then-rename.

## Reference examples

```powerfx
RenameColumns({z:3,a:1,m:2}, z, b)                         // {a:1,b:3,m:2}
RenameColumns({z:3,a:1,m:2}, a, x, z, y)                  // {m:2,x:1,y:3}
RenameColumns({a:1,b:2}, b, b)                            // {a:1,b:2}
RenameColumns({'First Name':1,z:3,a:2}, 'First Name', 'Last Name') // {'Last Name':1,a:2,z:3}
With({source:{a:1,b:2}, a:"old", c:"new"}, RenameColumns(source,a,c)) // {b:2,c:1}
```

In the multi-pair example the source field `a` maps to `x` and `z` maps to `y`; names are read from
the original record, not from intermediate renamed results. The output order is canonical, not pair
order. A rename to an existing field (including a swap), duplicate destination, or repeated source
is invalid. A lone rename to itself is a valid no-op.

## Reused components

- DropColumns/ShowColumns specialized binding patterns, identifier syntax handling, schema lookup and
  suggestions.
- Existing Record/Table types, immutable values, and per-row budget/cancellation checks.
- Pinned Power Fx reference harness and corpus replay for both numeric profiles.

## Exclusions

`AddColumns`, dynamic/untyped schemas, display-name/data-source metadata, delegation, and unrelated
table-function refactoring remain out of scope. Function coverage remains **partial** because only
the static Record/Table behavior is included.

## Evidence

Pre-implementation probes, exact source paths, regeneration commands, ordering observations, and
the accepted deviation are documented in
[`renamecolumns-probes/`](../research/renamecolumns-probes/). Per-case compatibility results against
the merged baseline are in [`renamecolumns-before-after.md`](../research/renamecolumns-before-after.md).
