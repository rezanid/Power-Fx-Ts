import {
  bind,
  DiagnosticCodes,
  parse,
  type BoundNode,
  type Diagnostic,
  type FormulaType,
  type ParseOptions,
  type Schema,
  schemasEqual,
  snapshotSchema,
  type UnsupportedFeature,
} from "@powerfx-ts/core";
import {
  evaluate,
  floatBackend,
  type CancellationSignal,
  type FormulaValue,
  type NumericBackend,
  type NumericValue,
  numericBackendId,
  type ValidatedValues,
  type ValidationResult,
  validateValues,
} from "@powerfx-ts/interpreter";

export interface EngineOptions {
  /** Numeric semantics; defaults to the IEEE-754 float backend. */
  readonly numeric?: NumericBackend;
  /** Evaluation step budget applied to every evaluation. */
  readonly maxSteps?: number;
  readonly parse?: ParseOptions;
}

export interface CheckOptions {
  /** Types of the names the formula may use. No runtime values are needed to check. */
  readonly schema?: Schema;
}

export interface CheckResult {
  readonly text: string;
  /** Frozen snapshot of the schema the formula was checked against. */
  readonly schema: Schema | undefined;
  /** Identity of the numeric backend instance used; reusable only with that same instance. */
  readonly numericId: number;
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
  /** Schema to check against; requires `values` validated against the same schema. */
  readonly schema?: Schema;
  readonly values?: ValidatedValues;
}

export interface EvaluateCheckedOptions {
  readonly signal?: CancellationSignal;
  readonly values?: ValidatedValues;
}

/**
 * Compile (parse + bind) and evaluate formulas over an explicit schema and separately validated
 * values. Checking and evaluation share one binder; there is no I/O.
 */
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

  /** Validates plain host input against `schema`; never coerces. See `validateValues`. */
  validateValues(schema: Schema, input: unknown): ValidationResult {
    return validateValues(schema, input, this.numeric);
  }

  check(text: string, options: CheckOptions = {}): CheckResult {
    const schema = options.schema === undefined ? undefined : snapshotSchema(options.schema);
    const parsed = parse(text, this.options.parse);
    const skipped = parsed.unsupportedSyntax.map((u) => ({ category: "construct" as const, ...u }));
    const bound = bind(parsed, schema === undefined ? {} : { schema });
    const unsupported = [...skipped, ...bound.unsupported];
    // Binding diagnostics on a partially bound tree are not trustworthy, so they are dropped
    // whenever unsupported constructs were skipped.
    const diagnostics = [
      ...parsed.diagnostics,
      ...(unsupported.length > 0 ? [] : bound.diagnostics),
    ];
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const ok = !hasErrors && unsupported.length === 0;
    return {
      text,
      schema,
      numericId: numericBackendId(this.numeric),
      diagnostics,
      unsupported,
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
    const checked = this.check(
      text,
      options.schema === undefined ? {} : { schema: options.schema },
    );
    return this.evaluateChecked(
      checked,
      options.values === undefined ? {} : { values: options.values },
      options.signal,
    );
  }

  /** Evaluates an already checked formula with another set of values; the schema is unchanged. */
  async evaluateChecked(
    checked: CheckResult,
    options: EvaluateCheckedOptions = {},
    signal: CancellationSignal | undefined = options.signal,
  ): Promise<EvaluationResult> {
    const values = options.values;
    const id = numericBackendId(this.numeric);
    if (checked.numericId !== id) {
      throw new TypeError("The formula was checked with a different numeric backend instance.");
    }
    if (values !== undefined && values.numericId !== id) {
      throw new TypeError("The values were validated with a different numeric backend instance.");
    }
    if (checked.schema !== undefined) {
      if (values === undefined) {
        throw new TypeError("Values validated against the schema are required.");
      }
      if (!schemasEqual(values.schema, checked.schema)) {
        throw new TypeError("The values were validated against a different schema.");
      }
    }
    // A too-large literal is a semantic error upstream (alongside the enclosing call's errors),
    // so it does not make unsupported syntax a user error.
    const syntaxErrors = checked.diagnostics.some(
      (d) => d.severity === "error" && d.code !== DiagnosticCodes.NumberTooLarge,
    );
    // Invalid syntax is a user error even when the formula also uses unimplemented constructs.
    if (checked.unsupported.length > 0 && !syntaxErrors) {
      return { kind: "unsupported", features: checked.unsupported };
    }
    if (checked.bound === undefined) return { kind: "invalid", diagnostics: checked.diagnostics };
    const value = evaluate(checked.bound, {
      numeric: this.numeric,
      ...(values === undefined ? {} : { variables: values.values }),
      ...(signal === undefined ? {} : { signal }),
      ...(this.options.maxSteps === undefined ? {} : { maxSteps: this.options.maxSteps }),
    });
    return { kind: "value", value };
  }
}
