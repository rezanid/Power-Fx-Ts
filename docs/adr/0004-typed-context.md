# ADR 0004: Typed context (schema, records, validated values)

Status: proposed (typed-context milestone; pending review)

## Model

- **Schema** (`core/types/schema.ts`) is plain data: named variables with `FormulaType`s and an
  optional `version`. It contains no runtime values, so a formula is checked once and evaluated
  many times. `FormulaType` gains `Record` (ordered fields; names case-sensitive).
- **One binder for both phases.** `Engine.check(text, {schema})` and `Engine.evaluate` both call
  `bind(parsed, {schema})`. The bound tree has `Variable` and `FieldAccess` nodes; the evaluator
  never re-resolves names or types.
- **Runtime values are separate** (`RecordValue` in `interpreter`). Host JS input is converted only
  by `validateValues(schema, input)`, which returns a branded `ValidatedValues` or a list of
  `ValueIssue`s with paths. `evaluateChecked(checked, {values})` re-runs a checked formula with new
  values; values validated against a different schema (structural comparison) throw `TypeError`.

## Rules

Upstream-derived (pinned `Binder.cs` `PostVisit(DottedNameNode)`, corpus `Record.txt`):

- Unknown name → "Name isn't valid. 'x' isn't recognized."
- Unknown field on a record → same message, span from the `.` to the end of the field name.
- `.` on a non-record (Number/Text/Boolean/Blank) → "The '.' operator cannot be used on {0} values."
  An already-erroneous left side reports `Error` (cascade, as upstream: `Record.txt`).
- A record used where a scalar is required → "Invalid argument type (Record). Expecting a {0} value
  instead." (wording from upstream `ErrBadType_ExpectedType_ProvidedType`).
- Field of a Blank record is Blank; a Blank field coerces to the zero value like any Blank.

Own design (no upstream equivalent; **for review**):

- Host input is strict, with no coercion: Number needs a finite JS number (NaN/±Infinity rejected),
  Text a string, Boolean a boolean, Record a plain object. `null`/`undefined` is Blank.
- A variable missing from the input is an error (`MissingVariable`); an omitted record field is
  Blank. Undeclared variables/fields are errors (closed schema).
- Unknown roots: `Custmer.RiskScore` is an ordinary unknown-name diagnostic. Only the 12 built-in
  upstream enum namespaces (`EnumStoreBuilder.DefaultEnumSymbols`, names from
  `LanguageConstants.*EnumString` in `Microsoft.PowerFx.Core`: Color, DateTimeFormat, StartOfWeek,
  SortOrder, TimeUnit, MatchOptions, Match, ErrorKind, JSONFormat, TraceSeverity, TraceOptions,
  JoinType) are `unsupported` when used as `Enum.Member` ("Member access on 'X'"). Matching is
  case-sensitive, as upstream, and a schema variable of the same name takes precedence. Option
  sets, data sources and host-added enums resolve upstream only through host configuration, so they
  are not in the list; if a host needs them it must declare them in the schema.
- Record `=`/`<>` is unsupported (upstream record equality not traced).

## Input contract

- **All declared variables must be supplied**, whether or not a formula references them: a
  validated value set belongs to the schema, not to one formula, so it is reusable across formulas.
  Supply `null` for Blank.
- **Extra input is rejected**, not ignored: undeclared variables and undeclared record fields are
  `UnexpectedVariable`/`UnexpectedField` issues. Omitted record fields (at any depth) and a Blank
  parent are Blank. All issues are collected with full paths (`A.B.C`).

## Reuse of checked results

`CheckResult` holds a deep-frozen snapshot of the schema and the numeric backend name; so does
`ValidatedValues`. Mutating the host's schema afterwards changes neither. `evaluateChecked`
throws `TypeError` if the schema snapshots differ or either the check or the values came from a
different numeric backend (numbers are backend-specific opaque values). `maxSteps` and the signal
are per-engine/per-call and do not affect semantics.

## Limitations

No tables, row scopes, record literals, `With`, option sets, untyped objects, locale-aware host
values, Decimal backend, or schema-derived dependency tracking. The compat corpus has no variable
setup, so these rules are tested by unit tests, not by upstream corpus verdicts; compat results are
unchanged (`v1-float`: pass 617, fail 1, unsupported 14295).
