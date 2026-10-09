declare const numericBrand: unique symbol;

/** Opaque Power Fx number. Only a `NumericBackend` may create or inspect one (ADR 0002). */
export interface NumericValue {
  readonly [numericBrand]: true;
}

/** Error kinds a numeric operation can report; mirrors the upstream `ErrorKind` member names. */
export type NumericErrorKind = "Div0" | "Numeric";

export type NumericResult =
  | { readonly ok: true; readonly value: NumericValue }
  | { readonly ok: false; readonly kind: NumericErrorKind };

/**
 * Arithmetic, parsing and formatting of Power Fx numbers. The evaluator is written against this
 * interface so a Decimal backend can be added in Phase 2 without changing evaluation code.
 */
export interface NumericBackend {
  readonly name: "float" | "decimal";
  readonly zero: NumericValue;
  readonly one: NumericValue;
  /** Parses a literal as produced by the lexer (invariant culture). */
  parseLiteral(text: string): NumericValue | undefined;
  /** Converts a host JS number; undefined for NaN/±Infinity or values the backend cannot hold. */
  fromNumber(n: number): NumericValue | undefined;
  /** Parses user text for implicit Text→Number coercion (invariant culture); undefined if invalid. */
  parseText(text: string): NumericValue | undefined;
  add(a: NumericValue, b: NumericValue): NumericResult;
  sub(a: NumericValue, b: NumericValue): NumericResult;
  mul(a: NumericValue, b: NumericValue): NumericResult;
  div(a: NumericValue, b: NumericValue): NumericResult;
  pow(a: NumericValue, b: NumericValue): NumericResult;
  negate(a: NumericValue): NumericValue;
  /** Negative, zero or positive, like a comparator. */
  compare(a: NumericValue, b: NumericValue): number;
  isZero(a: NumericValue): boolean;
  /** Invariant-culture text form used for Text coercion and result serialization. */
  format(a: NumericValue): string;
}

const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const asNumber = (v: NumericValue): number => v as unknown as number;
const wrap = (n: number): NumericValue => n as unknown as NumericValue;

function checked(n: number): NumericResult {
  return Number.isFinite(n) ? { ok: true, value: wrap(n) } : { ok: false, kind: "Numeric" };
}

/**
 * Formats like .NET Core 3.0+ `double.ToString()`: shortest round-trip digits, positional notation
 * for decimal exponents in [-5, 14] and `d.dddE+XX` otherwise (two-digit minimum exponent).
 */
export function formatDouble(n: number): string {
  if (n === 0) return "0";
  const [mantissa = "", exponentText = "0"] = n.toExponential().split("e");
  const exponent = Number(exponentText);
  if (exponent >= -5 && exponent < 15) return String(n);
  const sign = exponent < 0 ? "-" : "+";
  return `${mantissa}E${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** IEEE-754 double implementation (the `NumberIsFloat` behavior). */
export const floatBackend: NumericBackend = {
  name: "float",
  zero: wrap(0),
  one: wrap(1),
  parseLiteral(text) {
    const n = Number(text);
    return Number.isFinite(n) ? wrap(n) : undefined;
  },
  fromNumber: (n) => (Number.isFinite(n) ? wrap(n) : undefined),
  parseText(text) {
    const trimmed = text.trim();
    if (!NUMBER_TEXT.test(trimmed)) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? wrap(n) : undefined;
  },
  add: (a, b) => checked(asNumber(a) + asNumber(b)),
  sub: (a, b) => checked(asNumber(a) - asNumber(b)),
  mul: (a, b) => checked(asNumber(a) * asNumber(b)),
  div: (a, b) =>
    asNumber(b) === 0 ? { ok: false, kind: "Div0" } : checked(asNumber(a) / asNumber(b)),
  pow: (a, b) => checked(Math.pow(asNumber(a), asNumber(b))),
  negate: (a) => wrap(-asNumber(a)),
  compare: (a, b) => (asNumber(a) < asNumber(b) ? -1 : asNumber(a) > asNumber(b) ? 1 : 0),
  isZero: (a) => asNumber(a) === 0,
  format: (a) => formatDouble(asNumber(a)),
};
