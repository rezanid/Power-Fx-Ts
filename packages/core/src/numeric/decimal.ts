/**
 * Exact decimal arithmetic helpers shared by the lexer (literal range checks) and the interpreter's
 * Decimal backend, so both agree on what a representable Decimal is (ADR 0009).
 *
 * A decimal is `mantissa / 10^scale`. The range mirrors .NET `System.Decimal`, the upstream
 * implementation: a 96-bit magnitude and a scale of 0-28.
 */
export interface ScaledDecimal {
  readonly mantissa: bigint;
  readonly scale: number;
}

export const MAX_DECIMAL_MANTISSA = 79228162514264337593543950335n;
export const MAX_DECIMAL_SCALE = 28;

const pow10 = (n: number): bigint => 10n ** BigInt(n);
const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** `numerator / denominator` rounded to nearest, ties to even (.NET's default rounding). */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = abs(numerator);
  const d = abs(denominator);
  let q = n / d;
  const twiceRemainder = (n % d) * 2n;
  if (twiceRemainder > d || (twiceRemainder === d && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/**
 * Fits the exact value `mantissa / 10^scale` into the Decimal range, or returns `undefined` on
 * overflow. The scale is capped at 28 and then reduced until the magnitude fits 96 bits, rounding
 * once to nearest-even from the exact value; an integer part that cannot fit is an overflow.
 */
export function fitDecimal(mantissa: bigint, scale: number): ScaledDecimal | undefined {
  if (mantissa === 0n)
    return { mantissa: 0n, scale: Math.min(Math.max(scale, 0), MAX_DECIMAL_SCALE) };
  if (scale < 0) return fitDecimal(mantissa * pow10(-scale), 0);
  for (let drop = Math.max(0, scale - MAX_DECIMAL_SCALE); drop <= scale; drop++) {
    const rounded = drop === 0 ? mantissa : divRoundHalfEven(mantissa, pow10(drop));
    if (abs(rounded) <= MAX_DECIMAL_MANTISSA) return { mantissa: rounded, scale: scale - drop };
  }
  return undefined;
}

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

interface ScannedDecimal {
  readonly raw: ScaledDecimal;
  /** `ok`, or why the value cannot be represented (`overflow`) / is below the smallest scale. */
  readonly bounds: "ok" | "overflow" | "underflow";
}

function scanDecimalText(text: string): ScannedDecimal | undefined {
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return undefined;
  const [, sign = "", whole = "", fraction = "", exponentText = "0"] = match;
  if (whole === "" && fraction === "") return undefined;
  const digits = (whole + fraction).replace(/^0+/, "");
  if (digits === "") return { raw: { mantissa: 0n, scale: 0 }, bounds: "ok" };
  const exponent = Number(exponentText);
  // Guards the BigInt powers below: outside these bounds the value is out of range or rounds to 0.
  const magnitude = digits.length - fraction.length + exponent;
  const zero = { mantissa: 0n, scale: 0 };
  if (magnitude > MAX_DECIMAL_SCALE + 12) return { raw: zero, bounds: "overflow" };
  if (magnitude < -(MAX_DECIMAL_SCALE + 2)) return { raw: zero, bounds: "underflow" };
  const mantissa = BigInt(digits) * (sign === "-" ? -1n : 1n);
  return { raw: { mantissa, scale: fraction.length - exponent }, bounds: "ok" };
}

/**
 * Parses invariant-culture decimal text (`[+-]digits[.digits][e[+-]digits]`) like upstream's
 * `decimal.TryParse(NumberStyles.Float)` for this grammar: the value is rounded to the nearest
 * representable decimal; `undefined` means malformed or too large.
 */
export function parseDecimalText(text: string): ScaledDecimal | undefined {
  const scanned = scanDecimalText(text);
  if (scanned === undefined || scanned.bounds === "overflow") return undefined;
  if (scanned.bounds === "underflow") return { mantissa: 0n, scale: 0 };
  return fitDecimal(scanned.raw.mantissa, scanned.raw.scale);
}

/** Like `parseDecimalText` but `undefined` unless the text is represented without any rounding. */
export function parseDecimalExact(text: string): ScaledDecimal | undefined {
  const scanned = scanDecimalText(text);
  if (scanned === undefined || scanned.bounds !== "ok") return undefined;
  const { mantissa, scale } = scanned.raw;
  const fit = fitDecimal(mantissa, scale);
  if (fit === undefined) return undefined;
  const exact =
    scale < 0
      ? fit.mantissa === mantissa * pow10(-scale) && fit.scale === 0
      : fit.scale <= scale && fit.mantissa * pow10(scale - fit.scale) === mantissa;
  return exact ? fit : undefined;
}
