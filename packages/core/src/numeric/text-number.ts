/**
 * Culture-aware numeric text scanning (ADR 0010), independent of formula-source parsing.
 *
 * Upstream parses user text with .NET `double.TryParse` / `decimal.TryParse` using
 * `NumberStyles.Any`. This module reproduces that scanner (Number.Parsing.cs `TryParseNumber`) for
 * an explicit, closed set of cultures. It yields the sign, the significant digits and a decimal
 * point position; it never converts to a JS number, so Decimal text keeps all its digits.
 */

/** The number-format data of a supported culture, copied from the pinned reference runtime. */
export interface NumberCulture {
  readonly name: "en-US" | "fr-FR";
  readonly decimalSeparator: string;
  readonly groupSeparator: string;
  readonly currencySymbol: string;
  readonly positiveSign: string;
  readonly negativeSign: string;
}

// Values dumped from `CultureInfo.NumberFormat` by tools/reference-harness (generate-text), .NET 10.
export const EN_US: NumberCulture = {
  name: "en-US",
  decimalSeparator: ".",
  groupSeparator: ",",
  currencySymbol: "$",
  positiveSign: "+",
  negativeSign: "-",
};

export const FR_FR: NumberCulture = {
  name: "fr-FR",
  decimalSeparator: ",",
  groupSeparator: "\u202f",
  currencySymbol: "\u20ac",
  positiveSign: "+",
  negativeSign: "-",
};

const SUPPORTED_LOCALES = /^(?:(en)(?:[-_]us)?|(fr)(?:[-_]fr)?)$/i;

/**
 * Maps a locale argument to culture data. `undefined` means "not supported by this engine", which
 * is deliberately not "invalid": the reference accepts any well-formed name its ICU data knows, and
 * this engine has no culture database to tell valid from invalid names (ADR 0010).
 */
export function resolveNumberCulture(name: string): NumberCulture | undefined {
  const match = SUPPORTED_LOCALES.exec(name);
  if (match === null) return undefined;
  return match[1] === undefined ? FR_FR : EN_US;
}

/**
 * A scanned number: `0.d1d2d3… × 10^scale`, i.e. `digits` are the significant digits (leading
 * zeros removed, trailing zeros kept) and `scale` the position of the decimal point relative to the
 * first of them. An all-zero number has no digits and keeps the scale implied by its zeros.
 */
export interface ScannedNumber {
  readonly negative: boolean;
  readonly digits: string;
  readonly scale: number;
}

/** .NET `char.IsWhiteSpace`, the set `string.Trim()` removes. */
export function isCSharpWhiteSpace(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** C# `string.Trim()`; JS `trim()` differs (it also removes U+FEFF and not U+0085). */
export function trimCSharp(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isCSharpWhiteSpace(text.charCodeAt(start))) start++;
  while (end > start && isCSharpWhiteSpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Whitespace .NET skips inside a number: space and U+0009-U+000D only (not NBSP). */
const isNumberWhite = (code: number): boolean => code === 0x20 || (code >= 0x09 && code <= 0x0d);

const NON_BREAKING_SPACES = new Set(["\u00a0", "\u202f"]);

/** Exponents above this are treated as "huge" like .NET (`exp = 9999`). */
const EXPONENT_LIMIT = 1000;
const HUGE_EXPONENT = 9999;

/**
 * Scans `text` like `NumberStyles.Any` (leading/trailing white space and sign, parentheses, decimal
 * point, thousands separators, one currency symbol, exponent) in the given culture. Returns
 * `undefined` if the text is not a number. A leading `+`/`-` is accepted here; the Power Fx wrapper
 * rejects it earlier where upstream does.
 */
export function scanNumberText(text: string, culture: NumberCulture): ScannedNumber | undefined {
  const n = text.length;
  let p = 0;
  const code = (i: number): number => (i < n ? text.charCodeAt(i) : 0);
  // .NET also lets an ASCII space match a non-breaking separator (CLDR uses them for grouping).
  const match = (i: number, value: string): number => {
    if (value.length > 0 && text.startsWith(value, i)) return i + value.length;
    if (NON_BREAKING_SPACES.has(value) && text[i] === " ") return i + 1;
    return -1;
  };

  let sign = false;
  let parens = false;
  let negative = false;
  let currency: string | undefined = culture.currencySymbol;

  for (;;) {
    const ch = code(p);
    let next: number;
    // After a sign, white space is only skipped once the currency symbol was seen: `($ 12)`, not `( 12)`.
    if (isNumberWhite(ch) && (!sign || currency === undefined)) {
      p++;
    } else if (!sign && (next = match(p, culture.positiveSign)) >= 0) {
      sign = true;
      p = next;
    } else if (!sign && (next = match(p, culture.negativeSign)) >= 0) {
      sign = true;
      negative = true;
      p = next;
    } else if (ch === 0x28 && !sign) {
      sign = true;
      parens = true;
      negative = true;
      p++;
    } else if (currency !== undefined && (next = match(p, currency)) >= 0) {
      currency = undefined;
      p = next;
    } else break;
  }

  let digits = "";
  let scale = 0;
  let sawDigit = false;
  let sawNonZero = false;
  let sawDecimal = false;
  for (;;) {
    const ch = code(p);
    let next: number;
    if (ch >= 0x30 && ch <= 0x39) {
      sawDigit = true;
      if (ch !== 0x30 || sawNonZero) {
        digits += text[p];
        if (!sawDecimal) scale++;
        sawNonZero = true;
      } else if (sawDecimal) scale--;
    } else if (!sawDecimal && (next = match(p, culture.decimalSeparator)) >= 0) {
      sawDecimal = true;
      p = next;
      continue;
    } else if (sawDigit && !sawDecimal && (next = match(p, culture.groupSeparator)) >= 0) {
      p = next;
      continue;
    } else break;
    p++;
  }
  if (!sawDigit) return undefined;

  if (code(p) === 0x45 || code(p) === 0x65) {
    const mark = p;
    p++;
    let negativeExponent = false;
    let next: number;
    if ((next = match(p, culture.positiveSign)) >= 0) p = next;
    else if ((next = match(p, culture.negativeSign)) >= 0) {
      p = next;
      negativeExponent = true;
    }
    if (code(p) >= 0x30 && code(p) <= 0x39) {
      let exponent = 0;
      while (code(p) >= 0x30 && code(p) <= 0x39) {
        exponent = exponent * 10 + (code(p) - 0x30);
        p++;
        if (exponent > EXPONENT_LIMIT) {
          exponent = HUGE_EXPONENT;
          while (code(p) >= 0x30 && code(p) <= 0x39) p++;
        }
      }
      scale += negativeExponent ? -exponent : exponent;
    } else p = mark;
  }

  for (;;) {
    const ch = code(p);
    let next: number;
    if (isNumberWhite(ch)) p++;
    else if (!sign && (next = match(p, culture.positiveSign)) >= 0) {
      sign = true;
      p = next;
    } else if (!sign && (next = match(p, culture.negativeSign)) >= 0) {
      sign = true;
      negative = true;
      p = next;
    } else if (ch === 0x29 && parens) {
      parens = false;
      p++;
    } else if (currency !== undefined && (next = match(p, currency)) >= 0) {
      currency = undefined;
      p = next;
    } else break;
  }
  if (parens) return undefined;
  while (p < n && text.charCodeAt(p) === 0) p++;
  if (p < n) return undefined;
  return { negative, digits, scale };
}
