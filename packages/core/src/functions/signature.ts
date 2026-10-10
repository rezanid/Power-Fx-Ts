import { BlankType, BooleanType, type FormulaType } from "../types/formula-type.js";
import type { CoercionTarget } from "../ir/bound-tree.js";
import { unionTypes } from "../types/union.js";

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

/** One argument rejected by the `Coalesce` type fold (indexes refer to the call's arguments). */
export type CoalesceIssue =
  | { readonly index: number; readonly kind: "ErrorTyped" }
  | {
      readonly index: number;
      readonly kind: "Mismatch";
      /** The running type the argument had to match, as upstream names it (`"Error"` after an Error first argument). */
      readonly expected: FormulaType | "Error";
      readonly provided: FormulaType;
    };

export interface CoalesceFold {
  /** The running type after the fold; `"Error"` when the first argument is Error-typed. */
  readonly type: FormulaType | "Error";
  /** Scalar arguments that are coerced to the running type at their position in the fold. */
  readonly coercions: readonly (CoercionTarget | undefined)[];
  readonly issues: readonly CoalesceIssue[];
}

/**
 * Upstream `CoalesceFunction.CheckTypesLatest` (PowerFxV1 rules): fold left to right. An Unknown
 * argument stands for upstream's Error type. A Blank argument is skipped, a Blank running type
 * takes the next argument's type, otherwise the running type becomes
 * `TryUnionWithCoerce(running, arg, coerceToLeftTypeOnly)` and an argument of a different scalar
 * type is coerced to it. Records and tables are adjusted to the final union by the binder.
 */
export function foldCoalesce(argTypes: readonly FormulaType[]): CoalesceFold {
  const first = argTypes[0];
  let type: FormulaType | "Error" =
    first === undefined || first.kind === "Unknown" ? "Error" : BlankType;
  const issues: CoalesceIssue[] = [];
  const coercions: (CoercionTarget | undefined)[] = [];
  argTypes.forEach((arg, index) => {
    coercions.push(undefined);
    if (arg.kind === "Unknown") {
      issues.push({ index, kind: "ErrorTyped" });
      return;
    }
    if (arg.kind === "Blank") return;
    if (type === "Error") {
      issues.push({ index, kind: "Mismatch", expected: "Error", provided: arg });
      return;
    }
    const union = unionTypes(type, arg);
    if (union === undefined) {
      issues.push({ index, kind: "Mismatch", expected: type, provided: arg });
      return;
    }
    if (type.kind !== "Blank") coercions[index] = coercionTo(arg, union);
    type = union;
  });
  return { type, coercions, issues };
}

/** `Coalesce(arg, ...)`: the first argument that is neither Blank nor empty text; later arguments are lazy. */
const COALESCE: FunctionSignature = {
  name: "Coalesce",
  minArgs: 1,
  maxArgs: Infinity,
  lazy: true,
  check(argTypes) {
    const fold = foldCoalesce(argTypes);
    return {
      returnType: fold.type === "Error" ? BlankType : fold.type,
      coercions: fold.coercions,
      preserveBlank: argTypes.map(() => true),
    };
  },
};

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

export const BUILTIN_SIGNATURES: readonly FunctionSignature[] = [IF, COALESCE, BLANK, IS_BLANK];
export const BUILTIN_FUNCTIONS: FunctionRegistry = createFunctionRegistry(BUILTIN_SIGNATURES);
