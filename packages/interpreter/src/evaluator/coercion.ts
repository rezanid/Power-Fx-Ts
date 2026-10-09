import type { CoercionTarget } from "@powerfx-ts/core";
import type { NumericBackend } from "../numeric/backend.js";
import { boolean, error, number, text, type FormulaValue } from "../values/values.js";

/**
 * Implicit coercions between scalar values. Blank coerces to the target's zero value
 * (0, "", false); invalid text yields an `InvalidArgument` error value.
 */
export function coerceValue(
  value: FormulaValue,
  to: CoercionTarget,
  numeric: NumericBackend,
): FormulaValue {
  if (value.kind === "Error") return value;
  // The binder rejects record coercion, so this is unreachable for bound formulas.
  if (value.kind === "Record" || value.kind === "Table") {
    throw new Error("Records and tables cannot be coerced.");
  }
  switch (to) {
    case "Number":
      switch (value.kind) {
        case "Number":
          return value;
        case "Blank":
          return number(numeric.zero);
        case "Boolean":
          return number(value.value ? numeric.one : numeric.zero);
        case "Text": {
          if (value.value.trim() === "") return number(numeric.zero);
          const parsed = numeric.parseText(value.value);
          return parsed === undefined ? error("InvalidArgument") : number(parsed);
        }
      }
      break;
    case "Text":
      switch (value.kind) {
        case "Text":
          return value;
        case "Blank":
          return text("");
        case "Boolean":
          return text(value.value ? "true" : "false");
        case "Number":
          return text(numeric.format(value.value));
      }
      break;
    case "Boolean":
      switch (value.kind) {
        case "Boolean":
          return value;
        case "Blank":
          return boolean(false);
        case "Number":
          return boolean(!numeric.isZero(value.value));
        case "Text": {
          const lowered = value.value.toLowerCase();
          if (lowered === "true") return boolean(true);
          if (lowered === "false") return boolean(false);
          return value.value === "" ? boolean(false) : error("InvalidArgument");
        }
      }
  }
}
