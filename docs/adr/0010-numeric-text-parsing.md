# ADR 0010: Culture-aware numeric text parsing

Status: accepted (milestone PR). Pinned upstream `df4ceba5e08220db670c25afead342ce699c50b5`.

## Upstream behavior (reference)

`Decimal(text[, locale])`, `Float(...)` and `Value(...)` go through `LibraryTextToNumber.cs`, which
wraps `NumberStyles.Any` parsing in layers; each layer applies C# `Trim()`:

1. Blank, or `""` -> Blank. Whitespace-only -> InvalidArgument.
2. A leading or trailing `%` (both -> invalid): strip it, parse the rest, divide by 100 in the target
   numeric kind (decimal division, so 28-digit rounding applies).
3. One leading `+`/`-` is peeled; a second sign is invalid; `%` next to a sign is invalid.
4. The core parse is the .NET `NumberStyles.Any` scanner with the culture.
5. `Float`: NaN/Infinity (overflow) -> InvalidArgument. `Decimal`: out of range -> InvalidArgument;
   excess scale rounds half to even at 28 places.

Implicit Text->number coercion uses the same rules for en-US (`"1,5"+"2,5"` = 40, `"12%"+1` = 1.12);
`""` coerces to zero and whitespace-only text is an error.

## Grammar implemented (`core/src/numeric/text-number.ts`, `interpreter/src/numeric/text-number.ts`)

A port of the .NET scanner, not an Intl lookup: leading whitespace (ASCII only, not NBSP; skipped only
before a sign or after a currency symbol), sign, `(` (negative), culture currency symbol, digits with
one decimal separator and group separators (only after a digit, before the decimal point; ASCII space
also matches a U+00A0/U+202F separator), exponent (`e`/`E`, exponents over 1000 saturate), trailing
whitespace/sign/`)`/currency. Parentheses must close; trailing NULs are allowed; all text must be
consumed. Only the culture's own currency symbol is accepted. Non-ASCII digits, `NaN`, hex, `‰`,
`£`, `USD`, U+2212 are invalid. Formula-source number parsing and the strict host-input contract
(`parseExact`) are untouched.

## Culture matrix

| Locale                            | Decimal | Group  | Currency | Status                        |
| --------------------------------- | ------- | ------ | -------- | ----------------------------- |
| `en-US`, `en`, `en_US` (any case) | `.`     | `,`    | `$`      | supported                     |
| `fr-FR`, `fr`, `fr_FR` (any case) | `,`     | U+202F | `€`      | supported                     |
| any other name (including `""`)   | -       | -      | -        | **unsupported** (not invalid) |

Culture data is dumped from the reference (.NET 10 / ICU) into the fixture and asserted by tests.
The reference accepts almost any well-formed name (`xx`, `de-DE`) and returns BadLanguageCode for
malformed ones (`-`, `en-`, whitespace); `x-klingon` throws a null reference in the reference. With no
culture database, we report every non-listed name as `unsupported`: at check time for a Text literal
(`<Fn> with locale '<x>'`), at run time for a computed locale (`evaluateChecked` returns
`unsupported`, feature `locale '<x>'`). We never emit BadLanguageCode.

Locale argument rules: must be Text or Blank (else an argument-type diagnostic); arity 1-2; all
arguments are evaluated; errors propagate (value first), then Blank in either gives Blank; an Error
or Blank value argument wins before an unsupported locale is reported.

## Design

- `ConvertNumber` in the bound tree gains an optional `locale` node; `Value` shares the node and
  uses the profile's default numeric kind.
- `NumericBackend` gains a required `fromScanned(negative, digits, scale)`. This is a breaking change
  for custom backends. Decimal builds from a bigint mantissa (never `Number`); float uses the
  correctly rounded `Number("<digits>e<exp>")` and can produce negative zero.
- `formatDouble(-0)` now prints `-0`, as the reference does (`Float("-0")&""` = `"-0"`).

## Verification

- `tools/reference-harness generate-text` produces ~8,660 vectors (valid, malformed grouping,
  ambiguous separators, conflicting currency/percent, Unicode spaces, range/rounding, locale names)
  in both numeric profiles; `numeric-text-vectors.test.ts` replays them (float compared with
  `Object.is`) and asserts unsupported appears only for locale names outside the table.
- `numeric-text.test.ts` pins the rules individually. Compat: see
  `docs/research/numeric-text-before-after.md`.

## Known gaps

- Locales other than en-US/fr-FR; locale-name validation (BadLanguageCode).
- Culture-specific formatting (`Text(n, ..., locale)`); only parsing is covered.
- Remaining compat failures are unrelated to text parsing (cascaded out-of-range-literal diagnostics,
  one error-table serialization case, `^` last-ulp, `Text_ExcelCompat_PowerFxV1Compat.txt:13`).
