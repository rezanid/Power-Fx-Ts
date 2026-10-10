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
 * Arithmetic, parsing and formatting of one variety of Power Fx number (float or decimal). The
 * evaluator is written against this interface and picks the backend by value kind.
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
  /**
   * Builds a number from scanned culture text, `±0.digits × 10^scale` (see `ScannedNumber`), without
   * going through a JS number for exact backends. `undefined` if it is out of range for the backend.
   */
  fromScanned(negative: boolean, digits: string, scale: number): NumericValue | undefined;
  add(a: NumericValue, b: NumericValue): NumericResult;
  sub(a: NumericValue, b: NumericValue): NumericResult;
  mul(a: NumericValue, b: NumericValue): NumericResult;
  div(a: NumericValue, b: NumericValue): NumericResult;
  pow(a: NumericValue, b: NumericValue): NumericResult;
  negate(a: NumericValue): NumericValue;
  /** Negative, zero or positive, like a comparator. */
  compare(a: NumericValue, b: NumericValue): number;
  isZero(a: NumericValue): boolean;
  /**
   * Parses text that must be represented exactly (host input): `undefined` if it is malformed,
   * out of range, or would lose precision. No whitespace is trimmed.
   */
  parseExact(text: string): NumericValue | undefined;
  /** The nearest JS number; used for Decimal→Float conversion and never for host input. */
  toNumber(a: NumericValue): number;
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
  if (n === 0) return Object.is(n, -0) ? "-0" : "0";
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
  fromScanned(negative, digits, scale) {
    const n = Number(`${digits === "" ? "0" : digits}e${scale - digits.length}`);
    return Number.isFinite(n) ? wrap(negative ? -n : n) : undefined;
  },
  parseText(text) {
    const trimmed = text.trim();
    if (!NUMBER_TEXT.test(trimmed)) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? wrap(n) : undefined;
  },
  parseExact(text) {
    return NUMBER_TEXT.test(text) ? floatBackend.parseLiteral(text) : undefined;
  },
  add: (a, b) => checked(asNumber(a) + asNumber(b)),
  sub: (a, b) => checked(asNumber(a) - asNumber(b)),
  mul: (a, b) => checked(asNumber(a) * asNumber(b)),
  div: (a, b) =>
    asNumber(b) === 0 ? { ok: false, kind: "Div0" } : checked(asNumber(a) / asNumber(b)),
  pow: (a, b) =>
    asNumber(a) === 0 && asNumber(b) < 0
      ? { ok: false, kind: "Div0" }
      : checked(Math.pow(asNumber(a), asNumber(b))),
  negate: (a) => wrap(-asNumber(a)),
  compare: (a, b) => (asNumber(a) < asNumber(b) ? -1 : asNumber(a) > asNumber(b) ? 1 : 0),
  isZero: (a) => asNumber(a) === 0,
  format: (a) => formatDouble(asNumber(a)),
  toNumber: asNumber,
};

/**
 * The two numeric varieties of Power Fx (ADR 0009): `float` backs the Number type and `decimal`
 * the Decimal type. Both are needed whenever a formula can contain either.
 */
export interface Numerics {
  readonly float: NumericBackend;
  readonly decimal: NumericBackend;
}

const backendIds = new WeakMap<NumericBackend, number>();
let nextBackendId = 1;

/** Identity of a pair of backends; reuse is keyed by both instances (see `numericBackendId`). */
export function numericsId(numerics: Numerics): string {
  return `${numericBackendId(numerics.float)}:${numericBackendId(numerics.decimal)}`;
}

/**
 * Process-unique identity of a backend instance. Names are not unique (hosts may supply custom
 * backends), and `NumericValue`s from different instances are not interchangeable, so reuse of
 * checked results and validated values is keyed by this id, not by `name`.
 */
export function numericBackendId(backend: NumericBackend): number {
  let id = backendIds.get(backend);
  if (id === undefined) {
    id = nextBackendId++;
    backendIds.set(backend, id);
  }
  return id;
}
