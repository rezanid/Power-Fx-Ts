# Localization extensibility review

**Reviewed baseline:** `3f6d86bf3f597a38f190c94518aed69b4e0b2d92` (PR #25 merge).
**Upstream pin:** `df4ceba5e08220db670c25afead342ce699c50b5`.
**Scope:** Research only; no implementation or behavior changes.

## Findings

The current limited design is reasonably extensible for explicit numeric-text parsing. Core
`NumberCulture` data supplies separators, currency and signs to a culture-independent scanner.
The scanner returns sign, digits and scale; the Decimal backend builds the result from `BigInt`
through `fromScanned`, without passing exact Decimal input through JavaScript `Number`.
However, `resolveNumberCulture` only recognizes en-US and fr-FR. The reference-vector fixture
shows the pinned runtime accepts de-DE; the TypeScript engine still reports that locale unsupported.
Adding a culture's parsing data should not require changing the scanner or Decimal representation.

Keep these concerns distinct:

- **Formula syntax culture** affects source lexing and punctuation. The TypeScript parser/lexer
  currently has no culture option; its decimal and list punctuation are fixed. Runtime
  `Decimal(text, locale)` parsing does not localize formula literals.
- **Runtime value culture** affects text-to-number parsing and, when implemented, presentation.
  Explicit conversion locale is represented in the bound tree and resolved at evaluation. The
  implicit Text-to-number path and conversion without an explicit locale are hard-coded to en-US.
  `Engine` has no configurable culture default.
- **Diagnostic language** is not a formula or value culture. Diagnostics use stable codes and
  fixed English templates; there is no language selection or translated catalog.

There is no localized Decimal formatting. Decimal's current formatter emits normalized invariant
text, and compatibility serialization also uses invariant numeric strings. Preserve that
serialization contract separately from any future localized presentation: Decimal formatting must
operate on its exact mantissa and scale, not convert through JavaScript `Number`.

The en-US `Lower`/`Upper` behavior uses checked-in simple-case tables generated from .NET
`TextInfo`, not host casing APIs. This is deterministic for the committed mapping, but it does not
provide other cultures. Text equality separately uses JavaScript `localeCompare("en-US", ...)`,
whose collation can vary with host ICU data. Provenance for future culture data must name its
reference/runtime source, and updates need review rather than ambient host-data refreshes.

The parser, evaluator and culture tables avoid DOM and Node-specific APIs, which supports
browser/worker use. Current culture data is static and therefore does not require serialization.
If hosts later select cultures dynamically or send them across workers, define a small serializable,
validated culture configuration and its version/provenance; do not transmit runtime culture objects
or depend on ambient locale state.

Checked-result reuse currently validates numeric backend identity and number mode, not a culture
configuration. Explicit locale conversion is part of the checked formula; no compiled-check cache
exists today. Before adding configurable runtime defaults, define how the default is propagated
through `check`, `evaluate`, and `evaluateChecked`, and ensure checked-result reuse identity either
captures that semantic context or the checked result captures an immutable context snapshot. The
project plan already lists culture in a future semantic-cache key.

Pinned Power Fx is architectural evidence, not an automatic TypeScript requirement. Its
`ParserOptions.Culture` controls localized decimal/list/chaining punctuation; its runtime
`FormattingInfo.CultureInfo` is used by number conversion, and explicit locale arguments can select
a different culture. The upstream lexer maps localized punctuation to invariant token kinds. A
localized formula syntax implementation here would therefore be a separate lexer/parser feature,
including separator disambiguation and source-span preservation—not a side effect of adding
numeric culture data.

## Constraints and status

- Separate formula syntax culture, runtime value culture and diagnostic language.
- Preserve exact Decimal parsing and formatting without conversion through JavaScript `Number`.
- Keep invariant serialization separate from localized presentation.
- Define runtime-culture propagation and checked-result reuse identity before adding configurable
  defaults.
- Keep culture data deterministic, with explicit provenance and reviewed updates.
- Treat localized formula separators as a separate parser feature.

No immediate refactor is required for the existing en-US default and explicit en-US/fr-FR numeric
parsing. Additional cultures, localized formatting and configurable defaults remain **unimplemented
and unapproved**. No general localization framework is justified by the current code.

## Source references

TypeScript: `packages/core/src/numeric/text-number.ts` (`NumberCulture`,
`resolveNumberCulture`, `scanNumberText`); `packages/interpreter/src/numeric/text-number.ts`
(`parseNumberText`); `packages/interpreter/src/numeric/backend.ts` (`fromScanned`, invariant
`format`); `packages/interpreter/src/numeric/decimal.ts` (`fromScanned`, normalized `format`);
`packages/core/src/lexer/lexer.ts` and `packages/core/src/parser/parser.ts` (fixed syntax
punctuation and options); `packages/core/src/ir/bound-tree.ts`,
`packages/core/src/binding/binder.ts`, and `packages/interpreter/src/evaluator/evaluator.ts`
(`ConvertNumber` locale propagation); `packages/interpreter/src/evaluator/coercion.ts` (en-US
implicit coercion); `packages/engine/src/engine.ts` (options, check/evaluate/evaluateChecked and
numeric identity); `packages/core/src/diagnostics/diagnostic.ts` (stable codes and English
templates); `packages/interpreter/src/functions/text-case-map.ts` and
`packages/interpreter/src/functions/builtins.ts` (frozen en-US casing);
`packages/interpreter/src/evaluator/evaluator.ts` (`valuesEqual` collation);
`packages/engine/test/fixtures/numeric-text-vectors.json` (de-DE reference examples).

Repository decisions: `docs/adr/0002-compatibility-profiles-and-numerics.md`,
`docs/adr/0009-decimal-backend.md`, `docs/adr/0010-numeric-text-parsing.md`,
`docs/adr/0016-scalar-text-basics.md`, `docs/adr/0003-vertical-slice-engine-design.md`;
`docs/PowerFx-TypeScript-Plan.md` sections 25.1 and 29. Pinned upstream evidence:
`src/libraries/Microsoft.PowerFx.Core/Parser/ParserOptions.cs`,
`src/libraries/Microsoft.PowerFx.Core/Lexer/TexlLexer.cs`,
`src/libraries/Microsoft.PowerFx.Interpreter/Functions/FormattingInfo.cs`,
`src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryTextToNumber.cs`,
`src/libraries/Microsoft.PowerFx.Interpreter/Functions/LibraryText.cs`, and
`src/libraries/Microsoft.PowerFx.Core/Utils/TextFormatUtils.cs`.
