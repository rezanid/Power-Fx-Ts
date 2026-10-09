import {
  divRoundHalfEven,
  fitDecimal,
  MAX_DECIMAL_SCALE,
  parseDecimalExact,
  parseDecimalText,
  type ScaledDecimal,
} from "@powerfx-ts/core";
import type { NumericBackend, NumericResult, NumericValue } from "./backend.js";

const wrap = (d: ScaledDecimal): NumericValue => Object.freeze(d) as unknown as NumericValue;
const unwrap = (v: NumericValue): ScaledDecimal => v as unknown as ScaledDecimal;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

function fitted(mantissa: bigint, scale: number): NumericResult {
  const d = fitDecimal(mantissa, scale);
  return d === undefined ? { ok: false, kind: "Numeric" } : { ok: true, value: wrap(d) };
}

/** Rescales both operands to the larger scale (exact). */
function align(a: ScaledDecimal, b: ScaledDecimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.mantissa * pow10(scale - a.scale), b.mantissa * pow10(scale - b.scale), scale];
}

function parse(text: string): NumericValue | undefined {
  const d = parseDecimalText(text);
  return d === undefined ? undefined : wrap(d);
}

/** Invariant text without exponent or trailing zeros (upstream `DecimalValue.Normalize`). */
function format(a: NumericValue): string {
  const { mantissa, scale } = unwrap(a);
  const digits = (mantissa < 0n ? -mantissa : mantissa).toString().padStart(scale + 1, "0");
  const point = digits.length - scale;
  const fraction = digits.slice(point).replace(/0+$/, "");
  return `${mantissa < 0n ? "-" : ""}${digits.slice(0, point)}${fraction === "" ? "" : `.${fraction}`}`;
}

const toNumber = (a: NumericValue): number => Number(format(a));

/**
 * Exact decimal backend mirroring .NET `System.Decimal`, the upstream representation (ADR 0009):
 * 96-bit magnitude, scale 0-28, results rounded to nearest-even, overflow reported as the
 * `Numeric` error, division by zero as `Div0`. Values are immutable `{mantissa, scale}` pairs.
 */
export const decimalBackend: NumericBackend = {
  name: "decimal",
  zero: wrap({ mantissa: 0n, scale: 0 }),
  one: wrap({ mantissa: 1n, scale: 0 }),
  parseLiteral: parse,
  /**
   * Float→Decimal conversion: upstream's `(decimal)double` keeps 15 significant digits, so the
   * result of `0.1+0.2` converts to `0.3`. This is a conversion, not a host-input path.
   */
  fromNumber(n) {
    if (!Number.isFinite(n)) return undefined;
    return parse(n.toPrecision(15));
  },
  parseExact(text) {
    const d = parseDecimalExact(text);
    return d === undefined ? undefined : wrap(d);
  },
  parseText(text) {
    return parse(text.trim());
  },
  add(a, b) {
    const [x, y, scale] = align(unwrap(a), unwrap(b));
    return fitted(x + y, scale);
  },
  sub(a, b) {
    const [x, y, scale] = align(unwrap(a), unwrap(b));
    return fitted(x - y, scale);
  },
  mul(a, b) {
    const x = unwrap(a);
    const y = unwrap(b);
    return fitted(x.mantissa * y.mantissa, x.scale + y.scale);
  },
  div(a, b) {
    const x = unwrap(a);
    const y = unwrap(b);
    if (y.mantissa === 0n) return { ok: false, kind: "Div0" };
    // Largest scale (≤ 28) at which the correctly rounded quotient still fits 96 bits.
    for (let scale = MAX_DECIMAL_SCALE; scale >= 0; scale--) {
      const exponent = y.scale + scale - x.scale;
      const numerator = exponent >= 0 ? x.mantissa * pow10(exponent) : x.mantissa;
      const denominator = exponent >= 0 ? y.mantissa : y.mantissa * pow10(-exponent);
      const result = fitDecimal(divRoundHalfEven(numerator, denominator), scale);
      if (result !== undefined && result.scale === scale) return { ok: true, value: wrap(result) };
    }
    return { ok: false, kind: "Numeric" };
  },
  /** Power has no Decimal overload upstream; the binder always routes it through float. */
  pow(a, b) {
    const n = Math.pow(toNumber(a), toNumber(b));
    const value = decimalBackend.fromNumber(n);
    return value === undefined ? { ok: false, kind: "Numeric" } : { ok: true, value };
  },
  negate(a) {
    const x = unwrap(a);
    return wrap({ mantissa: -x.mantissa, scale: x.scale });
  },
  compare(a, b) {
    const [x, y] = align(unwrap(a), unwrap(b));
    return x < y ? -1 : x > y ? 1 : 0;
  },
  isZero: (a) => unwrap(a).mantissa === 0n,
  format,
  toNumber,
};
