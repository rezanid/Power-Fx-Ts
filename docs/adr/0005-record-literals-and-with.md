# ADR 0005: Record literals and `With`

Status: provisional (milestone review pending). Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Upstream sources

- `Binder.PostVisit(RecordNode)`: a field's type is its value's type; a duplicate name reports
  `ErrMultipleValuesForField_Name` on the value. `EvalVisitor.Visit(RecordNode)` evaluates every
  field in source order; a field error stays in the field.
- `With.cs`: arity exactly 2, no parameter coercion, the first argument must be a record (Blank
  accepted), the result type is the body's type. `Library.cs`: `ReturnBlankIfAnyArgIsBlank` +
  standard error handling, so a Blank or Error scope is returned and the body is **not** evaluated.
- Corpus: `With.txt`, `With_Float.txt`, `Record.txt`, `literals.txt`, `ReservedKeyword*.txt`.

## Rules implemented

- Record literals: typed and evaluated by the shared binder/interpreter. Fields are normalized by
  ordinal name in both type and value (`{b:2,a:1}` is `{a:1,b:2}`, per `literals.txt`).
  Evaluation still runs in source order. Results are deep-frozen (`record()`).
- `With(scope, body)`: the scope argument binds against the enclosing scopes, so
  `With({x:5}, With({x:x*2}, x))` is 10. Names are case-sensitive. The innermost With field wins
  over outer With fields and over schema variables (and over enum roots). Each `With` node has a
  unique scope id; the evaluator saves/restores its scope, so outer values survive inner scopes.
- Diagnostics: duplicate field (PFX2010), non-record scope (InvalidFunctionArguments + PFX2008),
  wrong arity, unknown names in the body, `If` mixing a record with a scalar (PFX2011).
- Blank field values behave as Blank (0 in arithmetic). A Blank scope yields Blank.
- Schema variables and validated values work inside `With`; the input contract of ADR 0004 is
  unchanged.

## Deviations and limitations

- A field whose value fails to bind makes the whole literal invalid (upstream keeps an Error-typed
  field). Only follow-on diagnostics can differ.
- If the `With` scope argument fails to bind, names in the body are not reported (avoids cascades,
  may hide genuine body errors until the scope is fixed).
- Unsupported (reported as `unsupported`, never as a pass): `ThisRecord`/row scopes, `As`, tables,
  record union in `If` (`If(false,{x:1},{z:2})`), record equality, string interpolation.
- Reserved keywords: upstream lexes unquoted reserved words (`blank`, `null`, `empty`, `none`,
  `nothing`, `undefined`, `Is`, `This`, `Child`, `Children`, `Siblings`) as error tokens with a
  specific 5-error recovery; we do not replicate it, so formulas using them unquoted are
  `unsupported` ("Reserved keyword"). The corpus serializer quotes reserved/keyword field names
  (`{'As':1}`), which the runner replicates. `DisableReservedKeywords` is not modelled.

## Compatibility

`v1-float`: pass 666, fail 1 (known `Text_ExcelCompat_PowerFxV1Compat.txt:13`), unsupported 14246
(baseline 617 / 1 / 14295). `v1-decimal` has no engine support yet (all unsupported).
