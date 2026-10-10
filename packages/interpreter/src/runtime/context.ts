import type { BoundNode } from "@powerfx-ts/core";
import type { Numerics } from "../numeric/backend.js";
import type { FormulaValue } from "../values/values.js";

/** Structural subset of `AbortSignal`, so the interpreter needs neither DOM nor Node typings. */
export interface CancellationSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

/** Host-supplied limits and services for one evaluation. No ambient globals are read. */
export interface EvaluationOptions {
  readonly numerics: Numerics;
  /** Validated runtime values of schema variables, by name. */
  readonly variables?: ReadonlyMap<string, FormulaValue>;
  /** Checked at every node; evaluation throws the signal's reason when aborted. */
  readonly signal?: CancellationSignal;
  /** Maximum number of nodes evaluated; exceeding it throws `EvaluationBudgetExceeded`. */
  readonly maxSteps?: number;
}

export class EvaluationBudgetExceeded extends Error {
  constructor() {
    super("The evaluation step budget was exceeded.");
    this.name = "EvaluationBudgetExceeded";
  }
}

/** Services a function implementation may use. Arguments are passed unevaluated. */
export interface EvaluationContext {
  readonly numerics: Numerics;
  evaluate(node: BoundNode): FormulaValue;
}

export type FunctionImplementation = (
  args: readonly BoundNode[],
  context: EvaluationContext,
) => FormulaValue;
