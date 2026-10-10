import { BlankType, BooleanType, type FormulaType } from "../types/formula-type.js";
import type { CoercionTarget } from "../ir/bound-tree.js";

export interface FunctionCheck {
  readonly returnType: FormulaType;
  /** Per-argument coercion target; `undefined` leaves the argument as is. */
  readonly coercions: readonly (CoercionTarget | undefined)[];
  /** Arguments whose Blank values stay Blank when coerced (e.g. `If` results). */
  readonly preserveBlank?: readonly boolean[];
}

/**
 * Signature shared by the binder (typing) and the interpreter (implementation lookup by name).
 * Registering a name here without an interpreter implementation is caught by a test.
 */
export interface FunctionSignature {
  readonly name: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  /** Arguments are evaluated on demand by the implementation (e.g. `If`). */
  readonly lazy: boolean;
  /** Called only when the argument count is within bounds. */
  readonly check: (argTypes: readonly FormulaType[]) => FunctionCheck;
}

export interface FunctionRegistry {
  get(name: string): FunctionSignature | undefined;
  names(): readonly string[];
}

export function createFunctionRegistry(signatures: readonly FunctionSignature[]): FunctionRegistry {
  const map = new Map(signatures.map((s) => [s.name, s]));
  return { get: (name) => map.get(name), names: () => [...map.keys()] };
}

/** First non-Blank result type, to which the other results are coerced. */
function resultTarget(types: readonly FormulaType[]): FormulaType {
  return types.find((t) => t.kind !== "Blank" && t.kind !== "Unknown") ?? BlankType;
}

function coercionTo(from: FormulaType, to: FormulaType): CoercionTarget | undefined {
  if (from.kind === to.kind) return undefined;
  if (
    to.kind === "Number" ||
    to.kind === "Decimal" ||
    to.kind === "Text" ||
    to.kind === "Boolean"
  ) {
    return to.kind;
  }
  return undefined;
}

/**
 * `If(cond, then [, cond2, then2, ...] [, else])`. Conditions coerce to Boolean; the result type is
 * the first non-Blank result argument, to which the others are coerced.
 */
const IF: FunctionSignature = {
  name: "If",
  minArgs: 2,
  maxArgs: Infinity,
  lazy: true,
  check(argTypes) {
    const results = argTypes.filter((_, i) => isResultArgument(i, argTypes.length));
    const target = resultTarget(results);
    return {
      returnType: target,
      coercions: argTypes.map((t, i) =>
        isResultArgument(i, argTypes.length) ? coercionTo(t, target) : coercionTo(t, BooleanType),
      ),
      preserveBlank: argTypes.map((_, i) => isResultArgument(i, argTypes.length)),
    };
  },
};

/** Odd positions are results; with an odd argument count the last is the `else` result. */
function isResultArgument(index: number, count: number): boolean {
  return index % 2 === 1 || (count % 2 === 1 && index === count - 1);
}

const BLANK: FunctionSignature = {
  name: "Blank",
  minArgs: 0,
  maxArgs: 0,
  lazy: false,
  check: () => ({ returnType: BlankType, coercions: [] }),
};

const IS_BLANK: FunctionSignature = {
  name: "IsBlank",
  minArgs: 1,
  maxArgs: 1,
  lazy: false,
  check: () => ({ returnType: BooleanType, coercions: [undefined] }),
};

export const BUILTIN_SIGNATURES: readonly FunctionSignature[] = [IF, BLANK, IS_BLANK];
export const BUILTIN_FUNCTIONS: FunctionRegistry = createFunctionRegistry(BUILTIN_SIGNATURES);
