import {
  bind,
  parse,
  type BoundNode,
  type Diagnostic,
  type FormulaType,
  type ParseOptions,
  type UnsupportedFeature,
} from "@powerfx-ts/core";
import {
  evaluate,
  floatBackend,
  type CancellationSignal,
  type FormulaValue,
  type NumericBackend,
  type NumericValue,
} from "@powerfx-ts/interpreter";

export interface EngineOptions {
  /** Numeric semantics; defaults to the IEEE-754 float backend. */
  readonly numeric?: NumericBackend;
  /** Evaluation step budget applied to every evaluation. */
  readonly maxSteps?: number;
  readonly parse?: ParseOptions;
}

export interface CheckResult {
  readonly text: string;
  /** Parse and binding diagnostics, parse diagnostics first. */
  readonly diagnostics: readonly Diagnostic[];
  /** Constructs outside the implemented slice; see `BindResult.unsupported`. */
  readonly unsupported: readonly UnsupportedFeature[];
  readonly type: FormulaType;
  /** Present when the formula bound without errors. */
  readonly bound: BoundNode | undefined;
  /** True when the formula has no error diagnostics and uses no unsupported construct. */
  readonly ok: boolean;
}

export type EvaluationResult =
  | { readonly kind: "value"; readonly value: FormulaValue }
  | { readonly kind: "invalid"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: "unsupported"; readonly features: readonly UnsupportedFeature[] };

export interface EvaluateOptions {
  readonly signal?: CancellationSignal;
}

/** Compile (parse + bind) and evaluate constant formulas. No variables, context or I/O yet. */
export class Engine {
  private readonly numeric: NumericBackend;

  constructor(private readonly options: EngineOptions = {}) {
    this.numeric = options.numeric ?? floatBackend;
  }

  get numberMode(): NumericBackend["name"] {
    return this.numeric.name;
  }

  /** Invariant-culture text form of a number, as used for Text coercion. */
  formatNumber(value: NumericValue): string {
    return this.numeric.format(value);
  }

  check(text: string): CheckResult {
    const parsed = parse(text, this.options.parse);
    const bound = bind(parsed);
    const diagnostics = [...parsed.diagnostics, ...bound.diagnostics];
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const ok = !hasErrors && bound.unsupported.length === 0;
    return {
      text,
      diagnostics,
      unsupported: bound.unsupported,
      type: bound.type,
      bound: ok ? bound.root : undefined,
      ok,
    };
  }

  /**
   * Async so hosts can later plug in lazy providers without an API break. Rejects with the
   * signal's reason when cancelled, or `EvaluationBudgetExceeded` when the budget runs out.
   */
  async evaluate(text: string, options: EvaluateOptions = {}): Promise<EvaluationResult> {
    const checked = this.check(text);
    if (checked.unsupported.length > 0) {
      // Diagnostics from a partially bound formula are not trustworthy, so none are reported.
      return { kind: "unsupported", features: checked.unsupported };
    }
    if (checked.bound === undefined) return { kind: "invalid", diagnostics: checked.diagnostics };
    const value = evaluate(checked.bound, {
      numeric: this.numeric,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(this.options.maxSteps === undefined ? {} : { maxSteps: this.options.maxSteps }),
    });
    return { kind: "value", value };
  }
}
