import type { CoercionTarget, NumericKind } from "@powerfx-ts/core";
import type { Numerics } from "../numeric/backend.js";
import {
  blank,
  boolean,
  decimal,
  error,
  number,
  text,
  type FormulaValue,
} from "../values/values.js";

/**
 * Implicit coercions between scalar values. Blank coerces to the target's zero value
 * (0, "", false); invalid text yields an `InvalidArgument` error value. `Number` is the float
 * variety and `Decimal` the exact one; Float→Decimal keeps 15 significant digits and reports
 * `InvalidArgument` when out of range, Decimal→Float is the nearest double.
 */
export function coerceValue(
  value: FormulaValue,
  to: CoercionTarget,
  numerics: Numerics,
): FormulaValue {
  if (value.kind === "Error") return value;
  // The binder rejects record coercion, so this is unreachable for bound formulas.
  if (value.kind === "Record" || value.kind === "Table") {
    throw new Error("Records and tables cannot be coerced.");
  }
  switch (to) {
    case "Number":
    case "Decimal": {
      const target = to === "Decimal" ? numerics.decimal : numerics.float;
      const wrap = to === "Decimal" ? decimal : number;
      switch (value.kind) {
        case "Number":
        case "Decimal": {
          if (value.kind === to) return value;
          if (to === "Number")
            return number(numerics.float.fromNumber(numerics.decimal.toNumber(value.value))!);
          const converted = numerics.decimal.fromNumber(numerics.float.toNumber(value.value));
          return converted === undefined ? error("InvalidArgument") : decimal(converted);
        }
        case "Blank":
          return wrap(target.zero);
        case "Boolean":
          return wrap(value.value ? target.one : target.zero);
        case "Text": {
          if (value.value.trim() === "") return wrap(target.zero);
          const parsed = target.parseText(value.value);
          return parsed === undefined ? error("InvalidArgument") : wrap(parsed);
        }
      }
      break;
    }
    case "Text":
      switch (value.kind) {
        case "Text":
          return value;
        case "Blank":
          return text("");
        case "Boolean":
          return text(value.value ? "true" : "false");
        case "Number":
          return text(numerics.float.format(value.value));
        case "Decimal":
          return text(numerics.decimal.format(value.value));
      }
      break;
    case "Boolean":
      switch (value.kind) {
        case "Boolean":
          return value;
        case "Blank":
          return boolean(false);
        case "Number":
          return boolean(!numerics.float.isZero(value.value));
        case "Decimal":
          return boolean(!numerics.decimal.isZero(value.value));
        case "Text": {
          const lowered = value.value.toLowerCase();
          if (lowered === "true") return boolean(true);
          if (lowered === "false") return boolean(false);
          return value.value === "" ? boolean(false) : error("InvalidArgument");
        }
      }
  }
}

/**
 * `Decimal(x)` / `Float(x)`: like the implicit coercion, except that Blank and empty text stay
 * Blank (upstream returns Blank for both) and whitespace-only text is invalid.
 */
export function convertNumber(
  value: FormulaValue,
  to: NumericKind,
  numerics: Numerics,
): FormulaValue {
  if (value.kind === "Blank" || (value.kind === "Text" && value.value === "")) return blank;
  if (value.kind === "Text") {
    const target = to === "Decimal" ? numerics.decimal : numerics.float;
    const parsed = target.parseText(value.value);
    if (parsed === undefined) return error("InvalidArgument");
    return to === "Decimal" ? decimal(parsed) : number(parsed);
  }
  return coerceValue(value, to, numerics);
}
