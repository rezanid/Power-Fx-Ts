# Next milestone: `Coalesce`

Status: **PROPOSED**, pending owner acceptance. Do not implement until accepted.

Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`. Implementation baseline: `f2fa9d8`
(`main` after PR #10). Profiles: `v1-float` (default) and `v1-decimal`, both PowerFxV1, en-US.

## Why this is next

`Coalesce.txt` (77 cases) and `Coalesce_V1Compat.txt` (5) are all `unsupported` in both profiles
(committed reports at the baseline). It is one function whose pieces mostly exist: lazy arguments,
Blank/error propagation, and the `If` record/table union with explicit `Conform` nodes (ADR 0008).
The new work is argument coercion before selection and empty-text skipping. It avoids a function
family, new value kinds and any editor/connector work.

## Scope

Included:

- `Coalesce(arg1, …)` with one or more arguments under PowerFxV1 compatibility rules only
  (`Coalesce.cs` `CheckTypesLatest`).
- Scalar arguments of the types we already model (Number, Decimal, Text, Boolean, Blank).
- The record/table subset the existing union/conformance architecture already supports (the same
  shapes `If` accepts, ADR 0008). The five `Coalesce_V1Compat.txt` record cases are **required**.

Excluded (each reported `unsupported`, never approximated):

- Legacy (non-V1) compatibility rules (`CheckTypesLegacy`, `Supertype`).
- New value kinds: Date, Time, DateTime, option sets, untyped objects, GUID, etc.
- Unimplemented types or features inside aggregates are `unsupported`. Incompatible combinations of
  supported types (Record vs Table, aggregate vs scalar, incompatible nested field types) are
  `invalid` with upstream's diagnostics, as in `If`.
- `IfError`, `Left` and any other function family, behavior functions, delegation, editor UI.
- Any general coercion overhaul. Only what `Coalesce` needs is added; `If` behavior is unchanged.

## Semantics to implement (verify each against the pinned reference first)

Typing, left to right (`CheckTypesLatest`):

1. The result type starts as the first argument's type. For each argument: a static **Error-typed**
   argument (for example an out-of-range literal, ADR 0011) is diagnosed (`ErrTypeError`) and makes
   the call invalid; a Blank-typed argument is skipped for typing; if the running type is Blank it
   becomes the argument's type; otherwise the running type becomes
   `TryUnionWithCoerce(type, argType, coerceToLeftTypeOnly: true)`. Failure reports "Invalid
   argument type (X). Expecting a Y value instead." at the argument plus "The function 'Coalesce'
   has some invalid arguments." at the callee (see `Coalesce.txt:198` for the message shape).
2. Arguments whose type needed coercion are recorded as explicit coercions to the type at that
   point of the fold (**fold-time argument coercion**). Later widening does not retroactively
   re-coerce earlier arguments except through the record/table path below.
3. After the fold, the selected record/table value is adjusted to the final compile-time union
   shape (`MaybeAdjustToCompileTimeType`; missing fields become Blank, nested aggregates
   recursively). This is separate from argument coercion and must be modelled as its own bound
   step, e.g. the existing `Conform`.

Evaluation, left to right:

1. Arguments after the first are lazy: evaluate argument _i_ only if no earlier argument was
   selected or errored. Skipped arguments consume no evaluation budget and no cancellation check.
2. Per argument: `CheckCancel`, evaluate, apply the argument's coercion **before** selection.
   Typed runtime Blank and empty text are decided on the coerced value; do not assume
   `coerceValue` or the `If` path already has the right Blank/empty-text/error behavior
   (for example `coerceValue` turns Blank into zero for Number targets; Coalesce must preserve a
   typed Blank so it is skipped). A coercion failure produces the runtime error upstream produces.
3. A runtime Error value reached in order is returned immediately, unchanged (a multi-error value
   keeps all its errors); nothing after it is evaluated. A Blank or empty Text is skipped; any other
   value, including `" "`, `0` and `false`, is returned (after adjustment to the final shape).
4. If every argument is skipped, return Blank of the result type.

Static Error-typed arguments (compile-time diagnostics, expression never evaluated) are distinct
from runtime Error values (valid expression, error result).

## Corpus classification

Both corpus files carry no `disable:PowerFxV1` setup, so no case falls outside the profiles; the
reports count all 82 as applicable in both profiles. `Coalesce.txt` (no `#SETUP`) and
`Coalesce_V1Compat.txt` (`#SETUP: PowerFxV1CompatibilityRules`) cases are classified by the `>>` line:

| Group                                                 | Lines (`Coalesce.txt` unless noted)                                                                                                             | Count | Classification                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------------------------------------------------------------------------------------------- |
| Scalar, Blank/empty/laziness, bool, error propagation | 4, 8, 11, 14, 17, 20, 24, 27, 30, 33, 36, 40, 43, 46, 49, 53, 56, 61, 64, 67                                                                    |    20 | In scope (Text, Number, Boolean, Blank, `1/0`)                                                     |
| Cross-type coercion (Number, Text, Boolean)           | 85, 88, 92, 95, 99, 102, 129, 132, 136, 139, 143, 146, 149, 176, 179, 182, 185, 189, 192                                                        |    19 | In scope                                                                                           |
| Longer argument lists                                 | 282, 285, 288                                                                                                                                   |     3 | In scope                                                                                           |
| Requires `Left`                                       | 70, 73, 76, 79                                                                                                                                  |     4 | Excluded: `Left` is another function family (reached-error behavior is covered by the `1/0` cases) |
| Requires `IfError`                                    | 276, 279                                                                                                                                        |     2 | Excluded: `IfError` out of scope                                                                   |
| Date, Time, DateTime arguments or results             | 106, 109, 113, 116, 120, 123, 153, 156, 160, 163, 167, 170, 198, 204, 210, 214, 218, 221, 227, 233, 239, 243, 247, 251, 256, 260, 264, 268, 273 |    29 | Excluded: new value kinds                                                                          |
| `Coalesce_V1Compat.txt` records                       | 3, 6, 9, 12, 15                                                                                                                                 |     5 | In scope, **required**                                                                             |

Totals: 42 + 5 = 47 in scope; 35 excluded. The in-scope Number-to-Text cases (for example line 88,
`Coalesce("", 1, 2)` is `"1"`) and Number-to-Boolean case (line 185, `0` gives `false`) show the
coercion-before-selection requirement. Re-derive this table mechanically from the corpus at the start
of implementation and treat any drift as a finding.

## Reference evidence plan

Expectations come from the pinned corpus and the executable C# reference, never from our
implementation. The harness `eval` prints result kind and first error only and `check` prints only
diagnostics, neither a successful result type or a full multi-error value. Before implementing, extend
the harness (a small `type <profile> <file>` command printing `CheckResult.ReturnType`, and `eval`
serialization via `FormulaValue.ToExpression` for full values) and record the outputs in an ADR and
as fixtures in `packages/engine/test/fixtures`. Obtain, in both numeric profiles unless noted:

- Blank-only, empty-only, typed runtime Blank, whitespace, zero and false.
- Mixed Text/Boolean/Float/Decimal in both argument orders (Float and Decimal need `Float()` /
  `Decimal()` in `v1-float` and `v1-decimal`); empty-text coercion; invalid-text and coercion
  overflow.
- Reached versus skipped errors, including preservation of a multi-error value.
- Record/table unions, three-argument widening, missing and nested fields, field-level errors.
- Incompatible supported types, zero arity, Error-typed literal cascades and continued checking /
  result-type recovery after invalid arguments.
- Probes (result and static type): `Coalesce(If(false,false),"",true)`,
  `Coalesce(If(false,1),"",2)`, `Coalesce(If(false,1),"bad",2)`.

## Reuse

`ifAggregateUnion`/`conformTo` and `unionTypes` (`packages/core/src/types/union.ts`,
`packages/core/src/binding/binder.ts`); the lazy-call path used by `If`; signature table in
`packages/core/src/functions/signature.ts`; `packages/interpreter/src/evaluator/{evaluator,coercion}.ts`
(extend, do not rewrite); value constructors and `deepFreeze` in `packages/interpreter/src/values/values.ts`;
the compat runner and reference-vector tests in `packages/engine/test`.

## Acceptance criteria

1. Every in-scope case in the table above passes in both applicable profiles; every excluded case is
   still `unsupported` with the reason above (not `fail`); incompatible supported types are `invalid`
   with the upstream diagnostics.
2. Reference-backed semantic tests cover each evidence bullet; `If` behavior and tests unchanged.
3. Nested results, error arrays/objects and Decimal payloads are frozen; existing backend-instance
   and numeric-mode rejection is unchanged; no new backend contract break.
4. Skipped lazy arguments consume no evaluation budget; cancellation and budget exhaustion are
   tested during argument evaluation and during conformance.
5. Both compatibility reports are rerun with a per-case baseline comparison: zero pass-to-non-pass
   regressions; fixes, new failures and regressions reported separately. Exact Decimal comparison,
   upstream float tolerance and the separate strict-diagnostic reporting are preserved.
6. ADR written; build, test, lint and format pass; draft PR with CI green on the final commit;
   independent review before merge. Do not merge without owner acceptance.

## Open decision for the owner

Accept `Coalesce` as scoped here, or prefer `IfError` (56 cases, needs error-value semantics) or
`IsEmpty` (34 cases, needs table/Blank rules).
