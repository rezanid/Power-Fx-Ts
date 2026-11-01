# ADR 0017: `DropColumns` for static record/table values

Status: **accepted, implemented, reviewed, and merged in PR #21**. Baseline:
`fc59733cd2e562a1c93b673eed46fd4449a66ba8`. Upstream pin:
`df4ceba5e08220db670c25afead342ce699c50b5`. Merge commit:
`e2d4624f0ab599745c23a0548622811cb8e59748`.

## Decision

Implement `DropColumns(source, name, ...)` for statically typed Record and Table values in the
PowerFxV1 profile.

- Require at least one column argument. The first argument must bind to a Record or Table; no source
  coercion is added.
- PowerFxV1 enables `SupportColumnNamesAsIdentifiers`. Column arguments are bare or escaped
  identifier nodes, not text literals or arbitrary expressions. The binder reads their names from
  syntax and does not resolve or evaluate them as variables, even when a schema or scope contains a
  same-named variable.
- Resolve each name against the current schema in sequence. Names are case-sensitive. A missing
  name, including a repeated name after its first removal, produces a column diagnostic and the
  generic invalid-function-arguments diagnostic. Suggestions follow upstream's similar-name
  behavior.
- Return a Record or Table with the selected fields removed from its static type. Runtime projection
  preserves retained values and their order; dropping every field produces empty records while
  preserving table row count and order.
- Top-level Blank and Error values pass through. Blank and Error table rows are retained unchanged.
  Record/table constructors keep projected values recursively frozen. Table projection checks
  cancellation and consumes one evaluation step for every visited row.

Examples from the pinned executable reference:

```powerfx
DropColumns({a:1,b:2}, b)                             // {a:1}
DropColumns(Table({a:1,b:2},{a:3,b:4}), a, b)         // Table({}, {})
With({b:99, source:{a:1,b:2}}, DropColumns(source,b)) // {a:1}
DropColumns({'First Name':1,b:2}, 'First Name')      // {b:2}
```

The last two examples confirm that identifier tokens denote columns even if they also name a local
variable, and that escaped identifiers are supported. `"b"` is not valid column-name syntax in
PowerFxV1; `B` does not match `b`.

## Reused and changed components

- `FormulaType` record/table fields, `findField`, and the immutable Record/Table runtime values.
- Binder call handling, type diagnostics, and the bound IR; a dedicated node carries the source and
  literal column names so they are not treated as evaluated arguments.
- Evaluator construction, cancellation checks, and per-node/per-row budget accounting.
- Pinned corpus and generated reference-probe replay in both numeric profiles.

## Exclusions

`ShowColumns`, `RenameColumns`, `AddColumns`, dynamic/untyped schemas, host/data-source metadata,
delegation, and unrelated overload or table refactoring remain out of scope. Function coverage is
classified as **partial**, not fully implemented, because only supported static Record/Table sources
are covered.

## Evidence

Probe sources, commands and outputs are in
[`dropcolumns-probes/`](../research/dropcolumns-probes/). Per-case compatibility results against the
baseline are in [`dropcolumns-before-after.md`](../research/dropcolumns-before-after.md).
