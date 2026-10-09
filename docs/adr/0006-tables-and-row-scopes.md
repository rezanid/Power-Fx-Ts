# ADR 0006: Tables and row scopes

Status: provisional (milestone review pending). Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Upstream sources

- `Binder.cs`: `IsRowScopeField` (scope lookup), `PostVisit(AsNode)` (`ErrAsNotInContext`),
  `PostVisit(TableNode)` (table literal typing).
- `FunctionScopeInfo.GetScopeIdent`: with `As X` the identifier is `X` and
  `RequireScopeIdentifier` is true (fields are not implicit); without `As` it is `ThisRecord` and
  fields are implicit.
- `Filter.cs`, `Table.cs`, `With.cs`, `LibraryTable.cs` (evaluation).
- Corpus: `Table.txt`, `TableNodes.txt`, `FilterFunctions*.txt`, `FilterLookUp_TwoArg*.txt`, `With.txt`.

## Rules implemented

- **Types**: `Table(row)` where `row` is a record type (ordinal-sorted fields, as in ADR 0005).
  Values are immutable `TableValue`s whose rows are `Record | Blank | Error`; construction
  deep-freezes (ADR 0005 guarantees apply).
- **Row-scope lookup** (shared binder, one `Scope` stack for `With` and `Filter`), innermost first:
  a field of the scope is returned unless the scope requires its identifier; otherwise a name equal
  to the identifier returns the whole row (`ScopeRecord`). Scope names win over schema variables.
  Names are case sensitive. Inner scopes shadow outer fields but outer rows stay reachable by
  alias (`Filter(T As a, Filter(U As b, a.x = b.x))`).
- **`As`**: only a direct argument of a row-scope function (`With`, `Filter`, `Table`); elsewhere
  `ErrAsNotInContext` ("As is not permitted in this context"). Precedence is between `*` and
  prefix unary, as upstream.
- **`Filter(source, predicate)`**: exactly two arguments (V1); source must be a table; predicate
  Boolean or coercible; result type is the source type. Evaluation: true keeps the row, false or
  Blank drops it, an Error predicate yields an error row; a Blank row is a Blank scope; a Blank
  table gives Blank; an Error source propagates. Empty tables are valid.
- **`Table(...)`** and table literals `[ ... ]` (PowerFxV1 `TableSyntaxDoesntWrapRecords`:
  `[{a:1}]` is a table of records, `[1,2]` has a `Value` column). Record args are rows, an
  untyped Blank is a Blank row, table args are spliced (a typed Blank table contributes nothing,
  an Error table is the result), anything else is `ErrNeedRecordOrTable`. Row type is the union
  of the argument row types; rows are filled with Blank for fields they lack, in type order.
- **Error spans** follow upstream `GetTextSpan`: a binary expression is reported at its operator.
- **Budget/cancellation**: one tick per node and one per table row visited.
- **Host inputs**: a Table variable is an array of plain objects; `null` is a Blank row; extra
  fields are rejected (ADR 0004 contract); issue paths look like `Scores[0].Score`.

## Table type inference scope

Implemented: identical field types merge, disjoint fields are added. Reported as **unsupported**
(never approximated): same-name fields with different types (upstream coerces some pairs, e.g.
Boolean to Number, and fails others with `ErrTableDoesNotAcceptThisType`; we cannot yet tell which),
nested record type unions, `[Blank()]`, mixed scalar/record literals, nested tables in literals.

## Deviations and limitations

- Wrong-type `Filter` source: untyped Blank matches upstream (`Invalid argument type.` at the
  argument + invalid-arguments); other types report `NeedTable` at the call span, where upstream's
  exact set (it may add `ErrBadType`) is untraced.
- Arity below two reports the generic `BadArity`; three or more reports upstream's
  `ErrFilterFunction_OnlyTwoArgs` at the operator of the third argument.
- Error rows in a source table are passed to the predicate unchanged (unverified upstream).
- Unsupported: column projection `T.Field`, record/table equality, record/table unions in `If`,
  display names, delegation, data sources, and every other table function.
- Partial-binding limitation from ADR 0005 remains: if a scope argument fails, body diagnostics are
  suppressed.

## Compatibility results

`v1-float`: pass 739, fail 1 (known `Text_ExcelCompat_PowerFxV1Compat.txt:13`), skip 46,
unsupported 14,173 (baseline before this milestone: pass 678, fail 1, unsupported 14,234).
`v1-decimal` is entirely unsupported (no Decimal backend).
