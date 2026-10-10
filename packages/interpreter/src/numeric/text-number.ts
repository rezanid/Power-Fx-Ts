import { scanNumberText, trimCSharp, type NumberCulture } from "@powerfx-ts/core";
import type { NumericBackend, NumericValue } from "./backend.js";

/**
 * Upstream's text→number wrapper (`LibraryTextToNumber.cs`): a chain of functions that peel one
 * sign and one percent marker, then hand the remaining text to the culture scanner. The same chain
 * is used for Float and Decimal; only the final conversion and the `/100` differ by backend. The
 * functions mirror upstream one to one so the accepted grammar is the same, including its quirks
 * (a sign may follow a percent marker, `(12)%` is -0.12, `12%-` is invalid).
 */
export function parseNumberText(
  text: string,
  backend: NumericBackend,
  culture: NumberCulture,
): NumericValue | undefined {
  const hundred = backend.parseLiteral("100")!;
  const percent = (v: NumericValue | undefined): NumericValue | undefined => {
    if (v === undefined) return undefined;
    const r = backend.div(v, hundred);
    return r.ok ? r.value : undefined;
  };
  const negate = (v: NumericValue | undefined): NumericValue | undefined =>
    v === undefined ? undefined : backend.negate(v);
  const isSign = (c: string | undefined): boolean => c === "+" || c === "-";

  const unsignedNoPercent = (raw: string): NumericValue | undefined => {
    const s = trimCSharp(raw);
    if (s === "" || isSign(s[0]) || s[0] === "%" || s.endsWith("%")) return undefined;
    const scanned = scanNumberText(s, culture);
    return scanned === undefined
      ? undefined
      : backend.fromScanned(scanned.negative, scanned.digits, scanned.scale);
  };
  const signedNoPercent = (raw: string): NumericValue | undefined => {
    const s = trimCSharp(raw);
    if (s === "" || isSign(s[0]) || s[0] === "%" || s.endsWith("%")) return undefined;
    return unsignedNoPercent(s);
  };
  const signedPossiblyPercent = (raw: string): NumericValue | undefined => {
    const s = trimCSharp(raw);
    if (s === "" || isSign(s[0])) return undefined;
    const starting = s[0] === "%";
    const ending = s.endsWith("%");
    if (starting || ending) {
      if (starting && ending) return undefined;
      return percent(unsignedNoPercent(starting ? s.slice(1) : s.slice(0, -1)));
    }
    return unsignedNoPercent(s);
  };
  const possiblySignedNoPercent = (raw: string): NumericValue | undefined => {
    const s = trimCSharp(raw);
    if (s === "") return undefined;
    if (s[0] === "+") return signedPossiblyPercent(s.slice(1));
    if (s[0] === "-") return negate(signedPossiblyPercent(s.slice(1)));
    return unsignedNoPercent(s);
  };
  const percentage = (raw: string): NumericValue | undefined => {
    const s = trimCSharp(raw);
    if (s === "" || s[0] === "%" || s.endsWith("%")) return undefined;
    if (s[0] === "+") return signedNoPercent(s.slice(1));
    if (s[0] === "-") return negate(signedNoPercent(s.slice(1)));
    return possiblySignedNoPercent(s);
  };

  const s = trimCSharp(text);
  if (s === "") return undefined;
  const starting = s[0] === "%";
  const ending = s.endsWith("%");
  if (starting || ending) {
    if (starting && ending) return undefined;
    return percent(percentage(starting ? s.slice(1) : s.slice(0, -1)));
  }
  return possiblySignedNoPercent(s);
}
