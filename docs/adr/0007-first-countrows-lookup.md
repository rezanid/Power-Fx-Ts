# ADR 0007: Column projection, First, CountRows, LookUp

Status: provisional (milestone review pending). Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Upstream sources

- `Binder.cs` `PostVisit(DottedNameNode)`; `FirstLast.cs`, `CountRows.cs`, `Lookup.cs`,
  `FunctionScopeInfo.cs`; `LibraryTable.cs` (`LookUp`, `CountRows`, `LazyFilterAsync`);
  `Library.cs` registrations.
- Corpus: `FirstLast*.txt`, `CountRows.txt`, `Lookup*.txt`, `FilterLookUp_TwoArg_V1Compat.txt`,
  `IfError_V1Compat.txt`.

## Rules implemented

- **`T.Field`**: under `PowerFxV1CompatibilityRules` upstream reports
  `ErrDeprecatedDotUseShowColumns` (PFX2019 here) at the dotted span; the interpreter never
  implemented single-column-table access. So it is an _invalid_ formula, not unsupported.
- **`First(table)`**: arity 1; type is the row record. Blank source -> Blank; error source -> that
  error; empty table -> Blank; an error or Blank first row is returned as is; a missing field on a
  record row reads as Blank. A non-table argument reports the invalid-arguments error plus
  `BadTypeExpected` (`Table`).
- **`CountRows(table)`**: Number. Blank -> 0; error source -> error; the first error _row_ is
  returned (field errors inside rows are values and are counted). Blank rows are counted.
- **`LookUp(source, predicate[, projection])`**: arity 2-3; row scope shared with `Filter`
  (`ThisRecord`, `As`, shadowing; with `As` fields are not implicit, in predicate and projection).
  Arguments past the third are bound outside the row scope. The predicate must be Boolean or an
  untyped Blank (no `Filter`-style coercions). Result type is the projection's type, else the row
  record.
- **Evaluation**: like upstream `LazyFilterAsync`, the predicate runs for _every_ row (no
  short-circuit; each row is charged one step and checks cancellation), then the first kept row is
  used. An error row is a match (`LookUp([0,3,4], 1/Value >= 0)` is Div0). The projection runs once
  in the matched row's scope; Blank row -> Blank scope. No match or Blank projection source -> Blank;
  error source -> error.

## Limitations and deviations

- Wrong-type `LookUp` source: untyped Blank gives `BadType` + invalid-arguments, other types only
  `BadType` (per corpus `Lookup_V1Compat.txt`); untraced beyond those corpus cases. `First`/
  `CountRows` accept an untyped Blank, other non-tables use `BadTypeExpected`.
- **LookUp projection on a selected error or Blank row** (verified by running the pinned C#
  `RecalcEngine`, PowerFxV1, en-US): `LookUp(Filter([0], 1/Value > 0), true, 42)` is `42`, an outer
  `With` variable works, and a Blank row with `42` or `IsBlank(ThisRecord)`-gated `7` works, so the
  projection runs on such rows (`row.Value` is null and passed as the scope). Reading the row
  (`Value`, `ThisRecord.Value`, `r.Value`, `a`, `ThisRecord`) throws a NullReferenceException in the
  reference: an upstream defect, not a language result. Proposed behavior (deviation, to review):
  the scope value is the error row itself (reads give that error, as for `Filter` predicates) or
  Blank for a Blank row (reads give Blank). 2-argument `LookUp` returns the error row (verified).
- `CountRows` is always a float Number; the decimal result under `disable:NumberIsFloat` is not
  modelled (no Decimal backend exists).
- Record/table `If` unions and coercing row unions are now supported (ADR 0008); `Sequence`-based
  large-table cases remain unsupported, as do `Sequence`-based large-table cases.
- Delegation, data sources, mutation, sorting, grouping and other functions are out of scope.

## Compatibility results

`v1-float`: pass 783, fail 1 (known `Text_ExcelCompat_PowerFxV1Compat.txt:13`), skip 46,
unsupported 14,129 (baseline: pass 739, unsupported 14,173). `v1-decimal` remains all unsupported.
