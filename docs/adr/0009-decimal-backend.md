# ADR 0009: Decimal numeric backend (first slice)

Status: provisional (milestone review pending). Upstream pin: `df4ceba5e08220db670c25afead342ce699c50b5`.

## Upstream semantics (verified with the pinned C# reference, `Features.PowerFxV1`)

- **Representation:** .NET `System.Decimal`: 96-bit magnitude, scale 0–28, max `79228162514264337593543950335`.
- **Rounding:** half-even, once, when a result has more than 28 fractional digits or exceeds 96 bits
  (`0.5e-28` → 0, `1.5e-28` → `2e-28`; literal `7.92281625142643375935439503355` →
  `7.922816251426433759354395034`).
- **Overflow:** `+ - *` and `/` beyond the range → `Error(Numeric)`; `MAX/0.1` overflows,
  `MAX/10` = `…033.5`. Division by zero → `Div0`. Division is quantized to 28 digits (`1/3*3` =
  `0.9999…`).
- **Literals:** in decimal mode a literal beyond the range is the diagnostic "Numeric value is too
  large" (`1E100`, `…335.5`); in float mode `1E100` is a Float.
- **Formatting:** normalized (`1.10` → `1.1`), no exponent.
- **Typing (`CheckDecimalBinaryOp`):** under `NumberIsFloat` the result is Number unless both operands
  are Decimal; in decimal mode the result is Number if either operand is Number, otherwise Decimal;
  Text/Boolean/Blank coerce to the result kind. `^` is always Float. Unary `-`/`%` keep the operand
  kind. `Decimal` displays as "Number" in diagnostics. `CountRows` is Decimal in decimal mode.
- **Comparison/equality:** Decimal vs Float converts the Decimal to double.
- **Unions (`If`, table rows):** left type wins (`If(true,1.5,Float(1))` is Decimal).
- **Conversions:** `Decimal(Float)` keeps 15 significant digits (`Decimal(Float(0.1+0.2))` = 0.3; |x|
  ≥ 1e29 → InvalidArgument); `Decimal("")`/Blank → Blank; whitespace-only text → InvalidArgument;
  `Float(Decimal)` is the nearest double.

## Options considered

| Option                                             | Verdict                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| decimal.js / big.js                                | Rejected: arbitrary precision with different defaults (precision, rounding, exponent formatting); every upstream rule (96-bit range, 28-digit scale, overflow) would be re-implemented on top, and defaults are not compatibility evidence. |
| JS Number with rounding                            | Rejected: cannot hold 28 digits (violates the host-input requirement).                                                                                                                                                                      |
| In-house BigInt scaled decimal `{mantissa, scale}` | **Chosen.** Small, no dependency, runs in browsers/workers; exact rules encoded once in `core/numeric/decimal.ts` (lexer range check) and `interpreter/numeric/decimal.ts` (backend).                                                       |

## Design

- Core adds a `Decimal` type kind, a `ConvertNumber` bound node (`Decimal(x)`/`Float(x)`), and a
  `numeric: "Number" | "Decimal"` field on binary nodes. Binder decides the kind once; the evaluator
  only follows it. Coercions (`Number`/`Decimal`/`Text`/`Boolean`) stay explicit `Coerce`/`Conform`
  nodes. Unions use the same left-wins rule as before.
- `Engine` takes `numberMode: "float" | "decimal"` (default **float**) and a `numeric`/`decimal` backend
  pair. The identity of reuse checks is the backend _instance pair_ plus the number mode, so
  same-named custom backends and cross-mode reuse of checked results/validated values are rejected.
- Host input for Decimal fields is explicit: a decimal string, a `bigint`, or a safe-integer
  `number`. Non-integer JS numbers, strings with more than 28 fractional digits or beyond the range,
  and non-numeric text are rejected, never rounded. Float fields are unchanged (finite JS number).
  `Float(Decimal)`/`Decimal(Float)` are the only implicit-looking bridges and are explicit calls.
- Values are immutable (deep-frozen); decimal values are frozen `{mantissa, scale}`.

## Default backend

The default stays **float**; decimal mode is opt-in (`numberMode: "decimal"`). Upstream V1 defaults
to decimal, so switching changes literal typing, `1/3`, formatting of results and `CountRows` type for
every existing consumer. **Decision needed from the maintainer** before any default change.

## Supported / deviations / unsupported

Supported: literals, `+ - * / ^ %`, unary minus, comparison/equality (incl. mixed), `Decimal()`,
`Float()` (single argument), Decimal-aware `If`/`Table`/record unions, `CountRows`, `Filter`, `First`,
`LookUp`, host input as above.

Known deviations (reported as **failures**, not hidden):

- **Culture-aware text parsing (≈231 cases in `Decimal.txt`, `Float.txt`, `ValueFuncs_*`).** Upstream
  parses `"123,456.78"`, `"$ 12.34"`, `"12.34%"`, `"(123)"`, `"%10"`. Ours accepts only an invariant
  `[+-]digits[.digits][e±n]` grammar (surrounding whitespace allowed) and returns InvalidArgument.
  The two-argument locale form `Decimal(x, locale)` is reported as unsupported.
- **Cascaded diagnostics (30 cases).** For invalid decimal literals upstream also reports "has some
  invalid arguments" and type errors; we report the literal diagnostic only (same partial-binding
  limitation as before).
- Division/rounding use exact-rational half-even; rare tie cases may differ from .NET.
- Float-mode mixed typing with Blank/Text/Boolean follows the upstream source (`CheckDecimalBinaryOp`)
  but was not verifiable with the reference (the harness runs decimal mode only).
- Evaluation-budget accounting is unchanged (not step-identical).

Unsupported: Date/Time, `Mod`, `ParseJSON`, `Round*`, `Sqrt` and other math builtins (many OpMatrix
cases), Dynamic values.

## Compatibility results

| Profile      | Before                                 | After                                      |
| ------------ | -------------------------------------- | ------------------------------------------ |
| `v1-float`   | pass 826 / fail 1 / unsupported 14,086 | pass 1,263 / fail 233 / unsupported 13,417 |
| `v1-decimal` | pass 0 / fail 0 / unsupported 16,117   | pass 2,121 / fail 262 / unsupported 13,734 |

No previously passing case regressed (the one failure at `Text_ExcelCompat_PowerFxV1Compat.txt:13`
is pre-existing). All other new failures are cases that were previously `unsupported` and are now
executed (the two categories above, plus one error-table serialization at
`ValueFuncs_NumberIsFloat.txt:53`). The runner compares Decimal results exactly and scale-insensitively
like upstream `BaseRunner`.
