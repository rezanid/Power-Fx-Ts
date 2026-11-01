# ADR 0018: `ShowColumns` for static record/table values

Status: **accepted and implemented; independent review pending**. Baseline:
`e2d4624f0ab599745c23a0548622811cb8e59748`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`.

## Decision

Implement `ShowColumns(source, name, ...)` for statically typed Record and Table values in the
PowerFxV1 profile.

- Require at least one column argument and a Record/Table source.
- PowerFxV1 enables `SupportColumnNamesAsIdentifiers`; bare and escaped identifiers name columns.
  Text literals and other expressions are rejected. Names are taken from syntax and never resolved
  or evaluated as variables.
- Resolve each name against the source schema. Names are case-sensitive. Missing names produce a
  column diagnostic and the generic invalid-function-arguments diagnostic.
- Duplicate names produce the upstream warning on the repeated identifier and the generic
  invalid-function-arguments error. The call remains invalid.
- The result contains the requested fields in canonical ordinal name order, independent of the
  argument order. Runtime rows use the same order. This matches the pinned Power Fx type and value
  observations; serialized output is collected separately because `RecordValue.ToExpression` sorts
  fields itself.
- Top-level Blank and Error values propagate. Blank/Error table rows are preserved; retained field
  errors remain errors. Projection produces recursively frozen values and checks cancellation and
  consumes one evaluation step for every table row.

Reference examples:

```powerfx
ShowColumns({z:3,a:1,m:2}, z, m)                          // {m:2,z:3}
ShowColumns(Table({z:3,a:1,m:2},{z:6,a:4,m:5}), z, m)    // Table({m:2,z:3},{m:5,z:6})
With({z:99, source:{z:3,a:1,m:2}}, ShowColumns(source,z)) // {z:3}
ShowColumns({'First Name':1,z:3,a:2}, 'First Name', z)   // {'First Name':1,z:3}
```

In the first example, the source fields are authored as `z,a,m` and arguments as `z,m`; the output
is `m,z`, confirming that argument order does not determine the result. The order probe records the
bound type fields, direct runtime fields, and `ToExpression()` output independently.

## Reused components

- DropColumns' specialized call binding, syntax-only column name handling, column lookup and
  suggestions.
- Record/Table formula types, immutable values, and evaluator per-row cancellation/budget checks.
- Pinned Power Fx test corpus and reference-probe replay in both numeric profiles.

## Exclusions

`RenameColumns`, `AddColumns`, dynamic/untyped schemas, display-name/data-source metadata,
delegation, and unrelated table-function refactoring remain out of scope. Coverage remains
**partial**, because only statically supported Record/Table values are implemented.

## Evidence

Pre-implementation probes, exact sources, and the order-probe method are documented in
[`showcolumns-probes/`](../research/showcolumns-probes/). Per-case compatibility results against the
baseline are in [`showcolumns-before-after.md`](../research/showcolumns-before-after.md).
