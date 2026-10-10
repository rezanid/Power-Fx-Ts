# ADR 0008: Record/table type unions and coercions

Status: provisional (milestone review pending). Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Upstream sources

- `If.cs` `TryDetermineReturnTypePowerFxV1CompatRules`: result type starts as the first result's
  type, then folds `DType.TryUnionWithCoerce(type, argType, coerceToLeftTypeOnly: true)`.
- `DType.cs` `TryUnionWithCoerce`, `Union`, `UnionCore`: Blank (ObjNull) takes the other side;
  aggregates union per field (missing fields added, shared fields recursive); with left-only
  coercion scalar fields keep the left type; aggregate vs scalar and Record vs Table fail.
- `Table()` and table literals use the same union; failure reports `ErrTableDoesNotAcceptThisType`
  (PFX2016) at the argument, preceded for `Table(...)` by "has some invalid arguments" at the callee.
- Corpus: `TableCoercion.txt`, `Table.txt`, `TableNodes.txt`, `If_V1Compat.txt`,
  `FirstLast_V1Compat.txt`, `With_V1Compat.txt`, `CountRows.txt`.
- Runtime values were cross-checked by running the pinned C# `RecalcEngine` (PowerFxV1, en-US) on
  every matrix row below.

## Design

- `core/src/types/union.ts` holds the one definition: `unionTypes`/`unionRecords` (static) and
  `conformPlan(from, to)`, which yields an explicit `ConformPlan` (Scalar / Record / Table).
- The binder wraps each differing `If` result, `Table()` argument and table-literal item in a bound
  `Conform` node. The evaluator applies the plan and never inspects values to decide types.
- Field order of the union result is ordinal (as before); evaluation order stays source order, and
  `If` stays lazy because `Conform` wraps the result expression itself.
- Conform: Error and Blank pass through; missing fields become Blank; scalar fields coerce with the
  normal coercion (failure is a field-level `InvalidArgument` error, not a row error); a table
  conform charges one step per row. Results are deep-frozen.

## Compatibility matrix

| Case                                  | Example                                           | Outcome                                                          |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Identical types                       | `If(c,{a:1},{a:2})`                               | Supported, no `Conform`                                          |
| Disjoint / missing fields             | `If(c,{a:1},{b:2})` → `{a,b}`                     | Supported; missing = Blank                                       |
| Blank with typed value                | `If(c,{a:1},Blank())`, `[{a:1},Blank(),{a:true}]` | Supported; Blank rows stay Blank beside records                  |
| Same-name scalar, Number/Text/Boolean | `{a:1}` + `{a:"x"}`                               | Supported; left type wins, right coerced (failure = field error) |
| Incompatible field types              | `{a:1}` + `{a:{b:1}}`; Record vs Table            | Invalid: PFX2011 (`If`), PFX2016 (`Table`, literal)              |
| Nested records / tables               | `{a:{b:1}}` + `{a:{c:true}}`                      | Supported, recursive union                                       |
| Aggregate vs scalar in `If`           | `If(c,{a:1},"x")`                                 | Invalid: PFX2011                                                 |
| Scalar + Table items in literals      | `[[1],Blank()]`                                   | Supported (`{Value:...}` wrapping, as upstream)                  |
| All-Blank table                       | `[Blank()]`                                       | Unsupported ("Table of only Blank values")                       |
| Date/DateTime/GUID/Color etc. fields  |                                                   | Unsupported (types not modelled)                                 |
| Decimal                               |                                                   | Supported as a scalar (left type wins; see ADR 0009)             |
| `Switch`/`IfError`/`Coalesce` unions  |                                                   | Unsupported (not implemented)                                    |

Compatibility result (`v1-float`): pass 783 → 826, fail 1 (unchanged, `Text_ExcelCompat`),
`v1-decimal` all unsupported.

## Limitations

- Host-input values are not coerced (schema contract unchanged).
- Table-argument conforms in `Table(...)` are charged per row both when conforming and when
  splicing; budgets are not claimed to equal upstream step counts.
- Partial-binding body-diagnostic suppression (ADR 0005) remains.
