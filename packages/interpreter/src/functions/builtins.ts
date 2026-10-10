import { BUILTIN_SIGNATURES } from "@powerfx-ts/core";
import type { FunctionImplementation } from "../runtime/context.js";
import { blank, boolean, type FormulaValue } from "../values/values.js";
import { coerceValue } from "../evaluator/coercion.js";

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

const isBlank = (value: FormulaValue): boolean =>
  value.kind === "Blank" || (value.kind === "Text" && value.value === "");

export const BUILTIN_IMPLEMENTATIONS: ReadonlyMap<string, FunctionImplementation> = new Map([
  ["If", ifFunction],
  ["Coalesce", coalesceFunction],
  ["Blank", () => blank],
  [
    "IsBlank",
    (args, context) => {
      const value = context.evaluate(args[0]!);
      return value.kind === "Error" ? value : boolean(isBlank(value));
    },
  ],
]);

/** Names registered for binding that lack an implementation; must be empty (checked by a test). */
export function missingImplementations(): string[] {
  return BUILTIN_SIGNATURES.map((s) => s.name).filter((n) => !BUILTIN_IMPLEMENTATIONS.has(n));
}
