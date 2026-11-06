import { BUILTIN_SIGNATURES } from "@powerfx-ts/core";
import type { FunctionImplementation } from "../runtime/context.js";
import { LOWER_EN_US, UPPER_EN_US } from "./text-case-map.js";
import {
  blank,
  boolean,
  combineErrors,
  decimal,
  error,
  number,
  text,
  type FormulaValue,
} from "../values/values.js";
import { coerceValue } from "../evaluator/coercion.js";

function mapSimpleCase(
  value: string,
  ranges: readonly (readonly [number, number, number])[],
): string {
  let result = "";
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)!;
    let low = 0;
    let high = ranges.length - 1;
    let mapped = codePoint;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const [start, end, delta] = ranges[middle]!;
      if (codePoint < start) high = middle - 1;
      else if (codePoint > end) low = middle + 1;
      else {
        mapped += delta;
        break;
      }
    }
    result += String.fromCodePoint(mapped);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return result;
}

const lenFunction: FunctionImplementation = (args, context, returnType) => {
  const value = context.evaluate(args[0]!);
  if (value.kind === "Error") return value;
  if (value.kind !== "Text") throw new Error("Len argument was not coerced to text.");
  if (returnType.kind === "Decimal") {
    const result = context.numerics.decimal.fromNumber(value.value.length);
    return result === undefined ? error("Numeric") : decimal(result);
  }
  const result = context.numerics.float.fromNumber(value.value.length);
  return result === undefined ? error("Numeric") : number(result);
};

const lowerFunction: FunctionImplementation = (args, context) => {
  const value = context.evaluate(args[0]!);
  if (value.kind === "Error") return value;
  if (value.kind !== "Text") throw new Error("Lower argument was not coerced to text.");
  return text(mapSimpleCase(value.value, LOWER_EN_US));
};

const upperFunction: FunctionImplementation = (args, context) => {
  const value = context.evaluate(args[0]!);
  if (value.kind === "Error") return value;
  if (value.kind !== "Text") throw new Error("Upper argument was not coerced to text.");
  return text(mapSimpleCase(value.value, UPPER_EN_US));
};

const scalarMath =
  (name: "Abs" | "Int" | "Trunc"): FunctionImplementation =>
  (args, context, returnType) => {
    if (returnType.kind !== "Number" && returnType.kind !== "Decimal") {
      throw new Error(`${name} requires a numeric result type.`);
    }
    const operand = coerceValue(context.evaluate(args[0]!), returnType.kind, context.numerics);
    const precision =
      args[1] === undefined
        ? undefined
        : coerceValue(context.evaluate(args[1]), "Number", context.numerics);
    if (operand.kind === "Error" || precision?.kind === "Error") {
      return precision === undefined ? operand : combineErrors(operand, precision);
    }
    if (
      (operand.kind !== "Number" && operand.kind !== "Decimal") ||
      (precision !== undefined && precision.kind !== "Number")
    ) {
      throw new Error(`${name} arguments were not coerced to numeric values.`);
    }
    const backend = operand.kind === "Decimal" ? context.numerics.decimal : context.numerics.float;
    const digits = precision === undefined ? 0 : context.numerics.float.toNumber(precision.value);
    if (!Number.isFinite(digits)) return error("Numeric");
    const result =
      name === "Abs"
        ? backend.abs(operand.value)
        : name === "Int"
          ? backend.floor(operand.value)
          : backend.trunc(operand.value, digits);
    return result.ok
      ? operand.kind === "Decimal"
        ? decimal(result.value)
        : number(result.value)
      : error(result.kind);
  };

/** `If(cond, then [, cond2, then2, ...] [, else])`; evaluates only the branches it needs. */
const ifFunction: FunctionImplementation = (args, context) => {
  const count = args.length;
  let i = 0;
  for (; i + 1 < count; i += 2) {
    const condition = coerceValue(context.evaluate(args[i]!), "Boolean", context.numerics);
    if (condition.kind === "Error") return condition;
    if (condition.kind === "Boolean" && condition.value) return context.evaluate(args[i + 1]!);
  }
  return i < count ? context.evaluate(args[i]!) : blank;
};

/**
 * `Coalesce(arg, ...)`: the first argument that is neither Blank nor empty text, evaluated left to
 * right (the binder already coerced each argument, mapping empty text to Blank). A reached Error
 * is returned unchanged; arguments after the result are never evaluated.
 */
const coalesceFunction: FunctionImplementation = (args, context) => {
  for (const arg of args) {
    const value = context.evaluate(arg);
    if (value.kind === "Error") return value;
    if (!isBlank(value)) return value;
  }
  return blank;
};

/** `IsEmpty(table)`: Blank is treated as an empty table; rows are counted regardless of value. */
const isEmptyFunction: FunctionImplementation = (args, context) => {
  const value = context.evaluate(args[0]!);
  if (value.kind === "Error") return value;
  if (value.kind === "Blank") return boolean(true);
  if (value.kind === "Table") return boolean(value.rows.length === 0);
  throw new Error("IsEmpty argument is neither a table, Blank, nor Error.");
};

const isBlank = (value: FormulaValue): boolean =>
  value.kind === "Blank" || (value.kind === "Text" && value.value === "");

export const BUILTIN_IMPLEMENTATIONS: ReadonlyMap<string, FunctionImplementation> = new Map([
  ["If", ifFunction],
  ["Coalesce", coalesceFunction],
  ["Blank", () => blank],
  ["IsEmpty", isEmptyFunction],
  ["Len", lenFunction],
  ["Lower", lowerFunction],
  ["Upper", upperFunction],
  ["Abs", scalarMath("Abs")],
  ["Int", scalarMath("Int")],
  ["Trunc", scalarMath("Trunc")],
  [
    "IsBlank",
    (args, context) => {
      const value = context.evaluate(args[0]!);
      return value.kind === "Error" ? value : boolean(isBlank(value));
    },
  ],
  [
    "IsBlankOrError",
    (args, context) => {
      const value = context.evaluate(args[0]!);
      return boolean(value.kind === "Error" || isBlank(value));
    },
  ],
]);

/** Names registered for binding that lack an implementation; must be empty (checked by a test). */
export function missingImplementations(): string[] {
  return BUILTIN_SIGNATURES.map((s) => s.name).filter((n) => !BUILTIN_IMPLEMENTATIONS.has(n));
}
