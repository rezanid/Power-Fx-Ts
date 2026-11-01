# Power Fx TypeScript coverage and remaining-work inventory

**Baseline:** `7825b2a95d767b07b57327f5928fbbb18af55197` (PR #18 merge, current `main` at
research time). **Upstream:** Microsoft Power Fx
`df4ceba5e08220db670c25afead342ce699c50b5`, `Features.PowerFxV1`. Profiles are `v1-float`
(`NumberIsFloat`) and `v1-decimal` (Power Fx 1.0 numeric default), en-US, UTC.

This is a source- and corpus-based inventory, not a feature-completeness audit or a promise of
upstream parity. Function labels describe the current TypeScript slice and are not percentages of
Power Fx implemented.

## Executive summary

| Area                 | Current status                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expression runtime   | A real, tested TypeScript lexer/parser/binder/IR/evaluator supports a useful but narrow V1 slice. It is not a general Power Fx implementation.                                                                                                                   |
| Function names       | 145 distinct names registered by upstream Core plus feature-gated Core; 11 implemented in the supported slice, 4 partial, 129 missing, 1 deliberately excluded (`Patch`, a host mutation operation). Registration-object and overload counts are separate below. |
| Compatibility corpus | `v1-float`: 2,228 pass, 1 fail, 46 skip, 12,684 unsupported. `v1-decimal`: 2,758 pass, 1 fail, 56 skip, 13,358 unsupported.                                                                                                                                      |
| Authoring            | Editor-neutral language-service, serialization and test-runner packages are scaffolds only. There is no completion, signature help, hover, semantic information, formatting, or test-session implementation.                                                     |
| Integrations         | No Monaco/React editor, PCF control, LSP adapter, connector runtime, transport or gateway is implemented. These remain roadmap work.                                                                                                                             |

The corpus is one finite, setup- and profile-dependent upstream test set. It does not enumerate every
valid program, overload, locale, host configuration or language feature. Pass counts demonstrate
that a corpus case matched for that profile; unsupported includes missing features and missing setup
handlers; fail is not automatically a TypeScript semantic bug. None of these counts measures effort
or overall language completeness. Do not report a single completion percentage.

## Counting method and limits

1. The primary name inventory is the case-insensitive union of the unique `TexlFunction.Name`
   values in pinned `BuiltinFunctionsCore._library` and `_featureGateFunctions`. The pinned assembly
   was loaded by the reference harness and reflected: 220 `_library` registrations (139 unique
   names), 10 feature-gate registrations (7 unique names), 145 distinct names in the union. One name
   (`Boolean`) occurs in both registries.
2. Registrations are not overloads: each `TexlFunction` object can expose multiple signatures and
   type-dependent behavior. The 230 registration objects are reported only as registration counts.
   The detailed overload inventory below calls out known shapes and distinguishes overload gaps;
   this work did not enumerate every `GetSignatures()` expansion for every upstream function.
3. Upstream `OtherKnownFunctions` contains 66 additional distinct names. Three (`IsType`, `Patch`,
   `ShowColumns`) overlap the registered-name set, so there are 63 additional unique names outside
   the primary count. The list is maintained by upstream to recognize Power Apps/runtime functions
   without adding them to the shared Core library; it mixes host operations and functions that need
   more investigation. They are listed separately, not silently counted as Core functions or all
   labelled “host-only.”
4. TypeScript status is assessed from checked-in signatures, binder and evaluator paths, tests,
   ADRs, and explicit roadmap exclusions. **Implemented** means the primary supported V1 path has
   implementation and tests, not that every upstream overload/profile is complete. **Partial**
   means the function exists but known supported cases, type combinations, or overloads remain.
   **Missing** means no usable implementation in the current engine. **Excluded** is reserved for
   an explicit scope boundary, not a synonym for hard or unsupported.
5. Corpus totals are transcribed from the committed reports. Unsupported-file counts are sorted by
   corpus file and can overlap across thematic groups. Setup-unavailable cases are not evidence of
   missing formula semantics.

### Unique registered Core function names

| Status                         |   Count | Names                                                                                                                                           |
| ------------------------------ | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented in supported slice |      11 | `Blank`, `Coalesce`, `CountRows`, `Filter`, `First`, `If`, `IsBlank`, `IsBlankOrError`, `IsEmpty`, `Table`, `With`                              |
| Partial                        |       4 | `Decimal`, `Float`, `LookUp`, `Value`                                                                                                           |
| Missing                        |     129 | Listed in the function inventory below.                                                                                                         |
| Deliberately excluded          |       1 | `Patch` — registered by Core, but mutating data-source behavior belongs to an explicitly granted host capability, not the language-only engine. |
| **Total**                      | **145** | **Unique names**, not overload signatures.                                                                                                      |

`LookUp` is partial because its supported table/row-scope path exists, but some upstream error-row
and projection edge behavior is known to differ. `Decimal`, `Float`, and `Value` parse and convert
supported numeric/text inputs; locales are limited to en-US and fr-FR and formatting parity is
incomplete. The 11 implemented labels mean the documented slice is usable and tested; they do not
assert full upstream parity (e.g. values of unsupported types cannot be passed to `IsBlank`).

**Missing registered names, alphabetically:** `Abs`, `Acos`, `Acot`, `AddColumns`, `AmPm`,
`AmPmShort`, `And`, `Asin`, `AsType`, `Atan`, `Atan2`, `Average`, `Boolean`, `Char`, `ColorFade`,
`ColorValue`, `Column`, `ColumnNames`, `Concat`, `Concatenate`, `Cos`, `Cot`, `Count`, `CountA`,
`CountIf`, `Date`, `DateAdd`, `DateDiff`, `DateTime`, `DateTimeValue`, `DateValue`, `Day`,
`Dec2Hex`, `Degrees`, `DropColumns`, `EDate`, `EncodeHTML`, `EncodeUrl`, `EndsWith`, `EOMonth`,
`Error`, `Exp`, `Find`, `FirstN`, `ForAll`, `GUID`, `Hex2Dec`, `Hour`, `IfError`, `Index`, `Int`,
`IsClock24`, `IsError`, `IsNumeric`, `ISOWeekNum`, `IsToday`, `IsType`, `IsUTCToday`, `Language`,
`Last`, `LastN`, `Left`, `Len`, `Ln`, `Log`, `Lower`, `Max`, `Mid`, `Min`, `Minute`, `Mod`,
`Month`, `MonthsLong`, `MonthsShort`, `Not`, `Now`, `Or`, `ParseJSON`, `Pi`, `PlainText`, `Power`,
`Proper`, `Radians`, `Rand`, `RandBetween`, `Refresh`, `RenameColumns`, `Replace`, `RGBA`, `Right`,
`Round`, `RoundDown`, `RoundUp`, `Search`, `Second`, `Sequence`, `ShowColumns`, `Shuffle`, `Sin`,
`Sort`, `SortByColumns`, `Split`, `Sqrt`, `StartsWith`, `StdevP`, `Substitute`, `Sum`, `Summarize`,
`Switch`, `Tan`, `Text`, `Time`, `TimeValue`, `TimeZoneOffset`, `Today`, `Trace`, `Trim`,
`TrimEnds`, `Trunc`, `UniChar`, `Upper`, `UTCNow`, `UTCToday`, `VarP`, `Weekday`, `WeekdaysLong`,
`WeekdaysShort`, `WeekNum`, `Year`.

### Additional names known to upstream, outside the primary Core registry

`OtherKnownFunctions` has 66 names, including three overlaps already counted above. The 63
additional names are: `Assert`, `Back`, `Choices`, `Clear`, `ClearCollect`, `ClearData`, `Collect`,
`Concurrent`, `Confirm`, `Copy`, `DataSourceInfo`, `Defaults`, `Disable`, `Distinct`, `Download`,
`EditForm`, `Enable`, `Errors`, `Exit`, `GroupBy`, `HashTags`, `IsMatch`, `Join`, `JSON`, `Launch`,
`LoadData`, `Match`, `MatchAll`, `Navigate`, `NewForm`, `Notify`, `Param`, `PDF`, `Pending`, `Print`,
`ReadNFC`, `RecordInfo`, `Relate`, `Remove`, `RemoveAll`, `RemoveIf`, `RequestHide`, `Reset`,
`ResetForm`, `Revert`, `SaveData`, `ScanBarcode`, `Select`, `Set`, `SetFocus`, `SetProperty`,
`State`, `SubmitForm`, `TraceValue`, `Ungroup`, `Unrelate`, `Update`, `UpdateContext`, `UpdateIf`,
`User`, `Validate`, `ValidateRecord`, `ViewForm`.

This supplemental set is not all one kind of gap. Some functions are app/host operations or
mutation; some are recognizable language functions absent from the shared registry. The exact
boundary and support model must be researched per function before assigning future work. It also
does not include every Power Apps/custom connector/user-defined function or every name in the
TypeScript `KNOWN_UPSTREAM_FUNCTIONS` resource-key-derived heuristic.

### Overload and registration coverage

Upstream provides 220 shared-Core and 10 feature-gated registration objects; those collapse to
139 and 7 unique names respectively (145 unique across both). Core contains distinct table
(`...T`), untyped-object (`..._UO`), and specialized signatures, e.g. `Abs`/`AbsT`,
`IsBlank`/`IsBlankOptionSetValue`, `IsEmpty`/`IsEmpty_UO`, and `Text`/`Text_UO`. The TypeScript
registry has six general signatures; binder/evaluator special cases add `With`, `Filter`, `Table`,
`First`, `CountRows`, `LookUp`, and the three numeric conversions. It does not model upstream's
general overload/constraint system.

Current intentional overload and type limits include: no OptionSet, untyped-object, Date/Time,
GUID, Color, or host-specific formula types; only two locales for numeric text parsing; no `Last`,
`FirstN` or `LastN`; `IsEmpty` does not accept `IsEmpty_UO`; no generic table-lifted function
overloads; `LookUp` has one table/predicate/projection route; and type/error behavior is limited to
the current primitive/record/table model. These variants are not additional unique names unless
upstream exposes them as a distinct `Name`.

## Expression language, types and runtime

| Layer             | Implemented                                                                                                                                                                                              | Incomplete / absent                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lexing and syntax | Arithmetic/comparison/logical operators, identifiers, calls, literals, records, tables, comments, spans, selected malformed/incomplete recovery. `As` row aliases and optional chaining are represented. | Interpolation and `Type(...)` are marked unsupported; expression chaining requires an option and binder reports it unsupported; broader Power Fx syntax (including lambdas, behavioral formulas, declarations, named formulas and user-defined functions) is absent. Parser recovery and token/diagnostic parity are not comprehensive.                                                               |
| Binding and types | Primitive Number/Decimal/Text/Boolean/Blank, structural records/tables, schema variables, row scopes, selected type unions/conformance, coercion nodes and diagnostics.                                  | No Date, Time, DateTime, GUID, Color, OptionSet/enum, Dynamic/untyped object, control, view/entity/file/media, polymorphic or named types. Overload constraints, full coercion matrix, enums/options and aggregate equality are absent. Record/table comparisons are explicitly unsupported; all-Blank table literals are unsupported.                                                                |
| Evaluation        | Frozen values; arithmetic and selected operators; lazy `If`/`Coalesce`; records, tables, `With`, `Filter`, `First`, `CountRows`, `LookUp`; numeric backends; cancellation signal and per-node budget.    | No general function implementation registry for hosts or async external operations; no mutation/behavior functions. Dates/time zones, broad string/regex/JSON, most builtins, option sets, UDFs, delegation, dependency calculation and recalculation remain absent. Evaluation is synchronous internally despite async public engine methods; actual cooperative worker yielding is not implemented. |
| Host boundary     | Typed schemas separated from values; strict validation; recursively frozen values; backend identity checks; engine API returns distinct `value`/`invalid`/`unsupported`.                                 | Schema providers, lazy/paged metadata, versioned semantic snapshots, serialized worker messages, worker RPC, external capability authorization, operation effect descriptors, and host transport APIs are not implemented.                                                                                                                                                                            |
| Compatibility     | Pinned text corpus reader and float/decimal reports; unit/reference fixtures and distinct pass/fail/skip/unsupported outcomes.                                                                           | Some C# runner setup handlers, `#OVERRIDE` merging, `#NoValue`, date-tick tolerance, and host-specific `Error*` re-runs are missing; not every upstream unit/API suite is ported.                                                                                                                                                                                                                     |

These are not interchangeable statuses: a construct can parse but fail binding, bind to an
unsupported node, or be absent altogether. Invalid formulas are not the same as unsupported
semantics.

## Current compatibility evidence

Profiles use `PowerFxV1`, en-US, UTC, with Decimal support enabled. Current reports compare every
applicable case in the pinned 22,047-case corpus; profile applicability differs.

| Profile      | Applicable | Not applicable |  Pass | Fail | Skip | Unsupported (feature) | Unsupported (setup) |
| ------------ | ---------: | -------------: | ----: | ---: | ---: | --------------------: | ------------------: |
| `v1-float`   |     14,959 |          7,088 | 2,228 |    1 |   46 |                 9,521 |               3,163 |
| `v1-decimal` |     16,173 |          5,874 | 2,758 |    1 |   56 |                10,146 |               3,212 |

The one fail in each profile is `Text_ExcelCompat_PowerFxV1Compat.txt:13`; its diagnostics depend
on the unimplemented `Text` function. Many setup-unsupported cases need upstream-specific test
handlers or symbols, not just a language feature. “Pass” requires matching an applicable corpus
expectation under the project runner's comparison rules, not complete semantics for the function
or construct.

Large unsupported corpus clusters (counts are per file, not disjoint feature totals):

| Cluster / evidence     | `v1-float` examples                                                                                                         | `v1-decimal` examples                                                                                              | Likely gap or prerequisite                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Text/formatting        | `Text_ExcelCompat.txt` 1,015; `Text_ExcelCompat_PowerFxV1Compat.txt` 359; `Text_Format.txt` 150                             | Same file counts                                                                                                   | `Text` signatures, formatting backend, locale/culture, date/time types and formatting. Includes the sole existing fail. |
| Match/regex            | `MatchFunctions_Limited.txt` 525; `MatchFunctions_CaptureQuant.txt` 296; Unicode 147; newlines 153; email 128; comments 124 | Same major counts                                                                                                  | `Match`/`MatchAll`/`IsMatch`, regex-compatible behavior, record/table capture results, Unicode and setup flags.         |
| Enums/options          | `StronglyTypedEnum_BuiltInEnums.txt` 412; test enums 220; test enum option sets 217                                         | 412 / 220 / 217                                                                                                    | Enum/OptionSet types, symbols, coercion and the relevant configured test stores.                                        |
| Operators and coercion | Float operator matrices include `OpMatrix_Mod_Float.txt` 204 and comparison matrices up to 172 each                         | Decimal matrices include `OpMatrix_Mod_Decimal.txt` 219 and comparisons around 202 each                            | Missing type families and overloads, full operator matrix, Decimal/float compatibility and coercions.                   |
| Tables and collections | `SingleColumnTableCoercion.txt` 211; `TabularOverloadsBlanksAndErrors.txt` 84                                               | Same                                                                                                               | General table lifting/column overloads, Blank/Error row semantics and scalar/table coercion.                            |
| Dates and time         | `EDateEOMonth.txt` 182; `Date.txt` 152; `Time.txt` 142; `DateAdd.txt` 115                                                   | Same leading files                                                                                                 | Date/Time/DateTime types, constructors, operations, timezone, parsing and formatting.                                   |
| JSON / untyped object  | `ParseJson.txt` 171; `ParseJson_Arithmetic.txt` 108; `ParseJson_Coercions.txt` 102                                          | Same leading files                                                                                                 | JSON parsing plus Dynamic/untyped-object value/type and coercion design.                                                |
| Numeric behavior       | No Decimal backend corpus gap dominates the float profile; math families remain unsupported                                 | Decimal-specific files include `DecimalMathFuncs_NumberIsFloatDisabled_DVDecimal.txt` 145 and `DecimalOps.txt` 143 | Missing numeric builtins and precise decimal edge behavior; not just backend arithmetic.                                |

Counts are examples, not additions: a file may exercise multiple functions, setup requirements,
types and operators, and counts differ by profile.

## Authoring and integrations

| Component                         | State at baseline                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/language-service`       | Package name/export scaffold; completion, hover and semantic-info directories contain `.gitkeep`; no authoring service implementation. There is no signature-help implementation either.                                        |
| Engine/dependencies/recalculation | Check/evaluate and explicit schema/value validation work; `dependencies/` and `recalc/` are empty placeholders. No document snapshots or reactive recalculation graph.                                                          |
| Serialization/test runner         | Package entrypoints only; no versioned DTO conversion or headless test-session execution/UI.                                                                                                                                    |
| Monaco and React                  | No packages or adapters. No Power Fx editor providers, syntax colors, editor lifecycle management, React component, test dialog, or Monaco worker packaging.                                                                    |
| LSP                               | No protocol package, server lifecycle, transport, handlers or advertised capabilities. Upstream LSP is research/reference only; it is not a prerequisite for direct Monaco.                                                     |
| PCF / Dataverse                   | No control or integration package. No multiline field round-trip, PCF lifecycle, schema/context provider, deployed-host test or Dataverse metadata. The plan calls for a hosting experiment before product packaging decisions. |
| Connectors                        | No OpenAPI projection, operation/schema descriptors, function binding, request marshalling, connector transport, mocks or execution capabilities. Credentials and network transport remain intentionally outside the engine.    |
| Gateway/deployment                | No gateway, policy/identity layer, deployment recipes, or APIM integration. This is Phase 5, after connectors.                                                                                                                  |
| Worker                            | Core data structures are mostly serializable and public evaluation accepts cancellation/budget options, but no Worker adapter, protocol DTOs/RPC, yielding strategy or worker-host verification exists.                         |

The plan's Phase 3 authoring work depends on stable shared types/signatures and editor-neutral
services. Monaco can consume those services directly; LSP is a parallel adapter. PCF depends on a
validated editor/worker hosting experiment. Connectors depend on typed function/symbol registration,
effect/capability policy, serialization and an explicit host transport. A gateway depends on
connector transport and security design.

## Cross-feature prerequisites

These are high-leverage blockers; resolving one can unlock groups rather than a single function:

1. **Expand the semantic type/value model:** Date, Time, DateTime, GUID, OptionSet/enum, Dynamic and
   untyped objects; define culture/timezone assumptions and JSON/worker-safe representations.
   Needed by dates, text formatting/parsing, enums, JSON and many operator/function overloads.
2. **Generalize signatures and overload binding:** move from a small hand-built registry plus
   binder name switches to reusable signatures/constraints, parameter metadata, overload resolution,
   lazy/table-lifted forms and consistent diagnostics. Needed by most of the 129 missing registered
   names, overload parity and editor signature help.
3. **Function/effect host capabilities:** typed host-provided function symbols, async invocation,
   explicit pure/read/write/action effects, capability checks at runtime, mocks, cancellation and
   serialization. Needed by app functions, data mutation, connectors and secure testing; never put
   credentials or transport in core.
4. **Schema/context providers and semantic revisions:** stable versioned snapshots, lazy metadata,
   provider cancellation and cache identity. Needed by Dataverse/connector authoring, stale-result
   handling and reliable editor services.
5. **Compatibility setup coverage:** implement/measure corpus setup handlers and distinguish
   missing test environment from missing semantics. Needed for an honest signal on configured,
   enum-heavy, mutation and host-function behavior.

## Prioritized bounded milestone proposals

Effort is relative S/M/L engineering scope, not a calendar estimate. Compatibility gains are
qualitative: corpus cases overlap features and setup, so no additive pass forecast is implied.
These proposals are not accepted milestones.

| Priority / milestone                        | Scope and usefulness                                                                                                                                                                                             | Dependencies                                                                                  | Likely compatibility gain                                                                                                                             | Effort |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1. Date/time type foundation                | Add reference-derived Date/Time/DateTime values, constructors, literal/parsing rules, timezone policy and arithmetic/coercion tests. Enables useful business formulas and a base for formatting.                 | Type/value model and explicit culture/timezone decisions; keep locale assumptions documented. | Date, Time, DateAdd/DateDiff, EDate/EOMonth and many comparison/operator cases; unlocks date `Text` later.                                            | L      |
| 2. Text, formatting and conversion families | Add `Text` with supported format subset, then `Len`, trim/case, substring/search/replace, encoding and table-lifted forms by bounded family. Include the current `Text()` failure as a must-fix acceptance case. | General signature/overload design; Date/time milestone for date formatting; culture model.    | Largest visible corpus opportunity: the text files alone contain many thousands of cases, but setup and other dependencies constrain reachable gains. | L      |
| 3. Table transformations and aggregates     | Implement a selected stable group (`ShowColumns`, `DropColumns`, `RenameColumns`, `AddColumns`, `Sort`, `FirstN`/`Last`/`LastN`, numeric aggregates) with schema, row-scope and Error/Blank semantics.           | Signature/row-scope generalization; robust record/table types and coercion.                   | Table/coercion/aggregate and tabular-overload files; broad utility for application formulas.                                                          | L      |
| 4. Enum/OptionSet and error/type families   | Model enums and OptionSets (including member resolution and host-defined symbols); then a separate bounded slice for `IsError`, `Error`, and `IfError` semantics.                                                | Type/host-symbol model; option-set conversion rules; error type and lazy-call semantics.      | Built-in/test enum files and strongly typed overloads; error corpus groups.                                                                           | L      |
| 5. Editor-neutral authoring services        | Implement incomplete-document snapshots, check/diagnostics, completion and signature help against shared binder metadata, then hover/semantic info; verify UTF-16 ranges, cancellation and stale revisions.      | General signatures and schema snapshots. Does not require LSP or Monaco.                      | No direct corpus pass gain; enables reliable editor clients and validates language semantics during authoring.                                        | M/L    |

After these, schedule Monaco/React and the PCF hosting experiment as distinct integration milestones;
then LSP if consumers need it. OpenAPI connectors follow mature function/effect/capability and
serialization boundaries. The gateway is later still. This ordering preserves the plan's separation
between runtime parity and product integrations.

## Keeping status statistics consistent

Every feature PR should update this inventory or its linked evidence in the same change:

- Keep the baseline SHA, upstream pin, profile setup and exact report generation date together.
- Update function-name and overload statuses only from registration/binder/evaluator/test evidence.
  Add new names once, use the same category rules, and record excluded names with the specific
  approved boundary.
- Generate both compatibility reports on the merged baseline and candidate; compare per-case
  verdicts. Record fixes and regressions separately and require zero pass-to-non-pass regressions
  unless explicitly reviewed.
- Refresh README summary numbers directly from this inventory and current reports. Never derive an
  overall completion percentage from corpus results or mix scaffolding with delivered capability.
- Keep runtime, authoring, host integration and security capability status as separate dimensions.
  A planned package or interface is not implementation; an upstream registration is not a test of
  all overloads.
