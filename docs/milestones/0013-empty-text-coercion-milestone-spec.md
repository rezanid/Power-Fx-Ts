# Next milestone (proposal): empty text becomes Blank when coerced into `If` results and table literals

Status: **PROPOSED**, awaiting owner acceptance. Do not implement until accepted. Research only so far.

Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`. Baseline: `main` `f9df8bb` (after PR #12). Profiles:
`v1-float` (default) and `v1-decimal`, PowerFxV1, en-US. Prior art: ADR 0012 (`emptyTextAsBlank`).

## Problem and evidence

Upstream coerces `""` to Blank when text is coerced to Number, Decimal or Boolean (the same
coercion `Coalesce` uses). We map it to `0` / `false` in `If` results and in table literals, so a
Blank is lost and downstream behavior differs. Reference outputs from the pinned C# engine
(`tools/reference-harness probe`) for 45 expressions in both profiles are committed verbatim in
`docs/research/empty-text-probes/` (`reference.v1-float.tsv`, `reference.v1-decimal.tsv`; consumers in
`consumers.*.tsv`). Compared with the engine at `f9df8bb`, **25 of the 45 expressions differ in each profile** (the same
25; the rows below, plus the `Float`/`Decimal` and `With` variants). Probe files are re-checkable with the
harness; the 9 consumer probes in `consumers.*.tsv` are separate.

| Expression                                                            | Before (ours)          | Expected (reference)     |
| --------------------------------------------------------------------- | ---------------------- | ------------------------ |
| `If(false,1,"")`                                                      | `0`                    | `Blank`                  |
| `If(false,true,"")`                                                   | `false`                | `Blank`                  |
| `If(false,{a:1},{a:""})`                                              | `{a:0}`                | `{a:Blank}`              |
| `If(false,{a:{b:1}},{a:{b:""}})`                                      | `{a:{b:0}}`            | `{a:{b:Blank}}`          |
| `If(false,[{a:1}],[{a:""}])`                                          | `Table[{a:0}]`         | `Table[{a:Blank}]`       |
| `[{a:1},{a:""}]`                                                      | `Table[{a:1},{a:0}]`   | `Table[{a:1},{a:Blank}]` |
| `[1,""]` / `[true,""]`                                                | `…{Value:0}` / `false` | `…{Value:Blank}`         |
| `[{a:1,b:"s"},{a:"",b:2}]`                                            | `{a:0,b:"2"}` (row 2)  | `{a:Blank,b:"2"}`        |
| `With({x:""},If(false,1,x))`                                          | `0`                    | `Blank`                  |
| `Filter([{a:1},{a:""}],a=0)`                                          | `Table[{a:0}]`         | `Table[]`                |
| `Filter([{a:1},{a:""}],IsBlank(a))`                                   | `Table[]`              | `Table[{a:Blank}]`       |
| `CountRows(Filter([…],a=0))`                                          | `1`                    | `0`                      |
| `If(false,Decimal(1),"")`, `[Float(1),""]`, `[{a:Decimal(1)},{a:""}]` | zero of the kind       | `Blank`                  |

Already matching and must stay so (regression guards): `If(true,"",1)` → `""`, `If(false,"",1)` → `"1"`,
`If(false,1,"5")` → `5`, `If(false,1,"abc")` → `Error(InvalidArgument)`, `[{a:""},{a:1}]` →
`{a:""},{a:"1"}`, `[{a:1},{a:"x"}]` → field `Error(InvalidArgument)`, `[{a:1},{b:""}]`, `[1,Blank()]`,
`If(false,1,Blank())`, `If(1<0,1,"",2)` → `Blank`.

## Why this is a small slice, not a coercion redesign

`coerceValue` (`packages/interpreter/src/evaluator/coercion.ts`) also serves operands and conditions
(`1+""`, `-""`, `!""`, `""||true`, `If("",1,2)`). Probes (`consumers.*.tsv`) show these already match the
reference, because upstream's Blank reads as zero/false there; making that function return Blank would
change nothing observable but would touch every operator. So **do not change `coerceValue` or the
operand path**. The difference appears only where the coerced value is kept as data: the binder sites that
build a result from coercions. Exactly four sites:

1. `If` scalar results: `bindCall` → `coerce(a, check.coercions[i], preserveBlank)` (`binder.ts`, near `If` handling).
2. `If` aggregate results: `bindCall` → `conformTo(a, union)`.
3. Table literal rows: `bindTableLiteral` → `conformTo(value, target)`.
4. Table literal arguments (`Table(...)`/mixed items): the `conformTo(value, shape === "row" …)` site.

The evaluator already implements the behavior (`Coerce` and `Conform` with `emptyTextAsBlank`; Text target
unchanged; typed Blank and Errors pass through). Downstream effects (`Filter`, `CountRows`, `IsBlank`,
`LookUp`) then follow without changes.

## Scope

Included: set the empty-text-as-Blank behavior at the four sites above for Number, Decimal and Boolean
targets (nested records/tables recursively), in both profiles.

Excluded (unchanged): `coerceValue`, operators, conditions, `Value`/`Decimal`/`Float` (already Blank),
`Coalesce`, Text-target coercions, host input validation (strict, no coercion), `&`, new functions, Date/Time
types, other record/table constructors not listed, `Patch`/`Collect`, aggregate equality, any new coercion
kind.

## Unresolved architectural decision (owner)

All current `Conform` producers are selection or construction contexts (`Coalesce`, both `If` paths,
both table sites), so either: **(A, recommended)** make `Conform` always empty-text-as-Blank and drop its
optional flag (keep the flag only on `Coerce`, where operand-style coercions might later be added), or
**(B)** keep the flag and pass `true` at the four sites. (A) removes a way to forget the flag; (B) keeps
`Conform` neutral if a future non-selection producer appears. Also decide whether to keep
`If`'s scalar path on `Coerce` with the flag (needed either way). No other decision is open.

## Reference-backed tests (both profiles)

- Replay `docs/research/empty-text-probes/expressions.txt` against the committed reference TSVs in a new
  `empty-text.test.ts` (same canonical rendering and numeric normalization as `coalesce.test.ts`); copy
  fixtures into `packages/engine/test/fixtures/`. Extend probes where gaps appear, regenerating via the
  harness (`dotnet run --no-build -- probe <float|decimal> <file>`); never hand-write expectations.
- Existing `type-unions`, `table-*`, `record-*` tests must pass unmodified unless they asserted the old
  `""`→`0` behavior; any such change must be justified against a probe.

## Compatibility checks

Run both compat profiles and compare per-case verdicts to the `f9df8bb` baseline (generate the baseline
first; the committed reports are `v1-float` 2207/1/46/12705 and `v1-decimal` 2737/1/56/13379): zero
pass-to-non-pass regressions; report fixes separately. Any case that changes verdict in either direction
must be explained. Never weaken a verdict; the strict-diagnostic comparison stays informational.

## Runtime-safety requirements

- Results stay recursively frozen (records, tables, error arrays, Decimal payloads); Conform builds new
  values and never mutates inputs or shares mutable state between nodes.
- Per-row evaluation-budget ticks in table conformance and cancellation checks are unchanged; add tests
  that abort (structural `CancellationSignal`) during conformance and exhaust `maxSteps` in both profiles.
- Decimal text and values never pass through JS `Number`; backend-instance and numeric-mode rejection are
  unchanged.
- Typed Blank stays Blank; reached Errors pass through; invalid text still yields `InvalidArgument`.

## Acceptance criteria

1. Every probe in `docs/research/empty-text-probes/` matches the reference in both profiles, with the
   unchanged-behavior guards above.
2. Compat comparison and runtime-safety tests as above; build, test, lint, format and CI green.
3. ADR 0013 records the decision (A or B), evidence and remaining deviations; handoff updated; the next
   milestone recorded as a proposal only (candidates: `IfError`, `IsEmpty`).
