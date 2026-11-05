# ADR 0020: `AddColumns` for static record/table values

Status: **accepted and implemented; independent review pending**. Baseline:
`3d26204f5c970141a449cc596cf7969b6a18aaa9`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`.

## Decision

Implement `AddColumns(source, name, formula, ...)` for statically supported Record and Table values
in the PowerFxV1 profile.

- Require one or more name/formula pairs. Bare and escaped PowerFxV1 identifiers in name positions
  are read from syntax; they are not evaluated or resolved as runtime variables. A string literal
  is not a column identifier. Bare dotted syntax is bound as an expression outside the row scope and
  retains upstream diagnostics; an escaped dotted name is a single valid identifier.
- Bind every added expression against the original source row. Without an explicit `As` alias,
  source fields shadow outer variables. With an alias, qualified row fields use the alias while
  unqualified identifiers can resolve in the outer scope. Newly added fields are never visible to
  later expressions in the same call.
- Evaluate each row's expressions left-to-right and continue after a field-level Error. Empty tables
  retain the inferred output schema without evaluating addition expressions. Blank/Error table rows
  pass through without evaluating additions. Typed Blank/Error sources propagate.
- Reject existing-field collisions and repeated added names. Names are case-sensitive.
- Sort the output schema, runtime fields, and serialization fields in canonical ordinal order.
- Return recursively immutable results. Check cancellation and charge evaluation budget for each row
  and before each addition expression, in addition to normal evaluated-node checks.

## Reference examples

```powerfx
AddColumns({a:1}, b, a + 1)                         // {a:1,b:2}
AddColumns(Table({a:2}) As row, b, row.a + 1)       // Table({a:2,b:3})
With({a:90}, AddColumns(Table({a:2}), b, a))        // Table({a:2,b:2})
With({x:99}, AddColumns([{Value:1}], x, Value + 1, y, x + Value))
// Table({Value:1,x:2,y:100}); the second expression reads outer x=99.
AddColumns({a:1}, first, 1/0, second, 42)            // second is still evaluated as 42
AddColumns([], skipped, 1/0)                         // empty table; expression is not evaluated
```

In the aliased example, fields are accessed through `row`. An Error in one computed field does not
stop later additions. Blank/Error source values propagate; Blank/Error rows in a table are preserved
without evaluating row expressions.

## Reused components

- DropColumns/ShowColumns/RenameColumns binding patterns, PowerFxV1 identifier handling, schema
  construction, and column-name diagnostics.
- Existing row-scope and alias machinery, Record/Table types and frozen runtime values.
- Existing evaluator budget/cancellation checks and pinned reference harness/corpus runner.

## Exclusions

Dynamic/untyped schemas, data-source metadata/delegation, mutation, other table functions, and
unrelated refactoring remain out of scope. Function coverage remains **partial** because only static
Record/Table values are supported.

## Evidence

Pre-implementation probes, exact source paths, regeneration commands, and independent schema,
runtime-enumeration, and serialization observations are documented in
[`addcolumns-probes/`](../research/addcolumns-probes/). Per-case compatibility results against the
merged baseline are in [`addcolumns-before-after.md`](../research/addcolumns-before-after.md).
