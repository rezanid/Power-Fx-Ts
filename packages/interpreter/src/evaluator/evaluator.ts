import type { BoundNode } from "@powerfx-ts/core";
import { BUILTIN_IMPLEMENTATIONS } from "../functions/builtins.js";
import type { NumericBackend, NumericResult, NumericValue } from "../numeric/backend.js";
import {
  EvaluationBudgetExceeded,
  type EvaluationContext,
  type EvaluationOptions,
  type FunctionImplementation,
} from "../runtime/context.js";
import {
  blank,
  boolean,
  error,
  number,
  record,
  text,
  type FormulaValue,
  type RecordValue,
} from "../values/values.js";
import { coerceValue } from "./coercion.js";

export function evaluate(root: BoundNode, options: EvaluationOptions): FormulaValue {
  return new Evaluator(options).evaluate(root);
}

class Evaluator implements EvaluationContext {
  private steps = 0;
  /** Active `With` scope records by scope id; ids are unique per `With` node. */
  private readonly scopes = new Map<number, RecordValue>();

  constructor(private readonly options: EvaluationOptions) {}

  get numeric(): NumericBackend {
    return this.options.numeric;
  }

  evaluate(node: BoundNode): FormulaValue {
    this.options.signal?.throwIfAborted();
    if (this.options.maxSteps !== undefined && ++this.steps > this.options.maxSteps) {
      throw new EvaluationBudgetExceeded();
    }
    const numeric = this.numeric;

    switch (node.kind) {
      case "NumberLiteral": {
        const parsed = numeric.parseLiteral(node.text);
        return parsed === undefined ? error("Numeric") : number(parsed);
      }
      case "TextLiteral":
        return text(node.value);
      case "BooleanLiteral":
        return boolean(node.value);
      case "Coerce": {
        const operand = this.evaluate(node.operand);
        if (node.preserveBlank && operand.kind === "Blank") return operand;
        return coerceValue(operand, node.to, numeric);
      }
      case "Unary":
        return this.unary(node);
      case "Binary":
        return this.binary(node);
      case "Call": {
        const implementation: FunctionImplementation | undefined = BUILTIN_IMPLEMENTATIONS.get(
          node.fn,
        );
        if (implementation === undefined) {
          throw new Error(`No implementation registered for function '${node.fn}'.`);
        }
        return implementation(node.args, this);
      }
      case "Variable": {
        const value = this.options.variables?.get(node.name);
        if (value === undefined) throw new Error(`No value supplied for variable '${node.name}'.`);
        return value;
      }
      case "Record": {
        // Fields evaluate in source order; the value is normalized by ordinal name like the type.
        const fields = node.fields.map((f) => ({ name: f.name, value: this.evaluate(f.value) }));
        return record(fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
      }
      case "With": {
        const scope = this.evaluate(node.scope);
        if (scope.kind === "Error" || scope.kind === "Blank") return scope;
        if (scope.kind !== "Record") throw new Error("With scope is not a record.");
        const previous = this.scopes.get(node.scopeId);
        this.scopes.set(node.scopeId, scope);
        try {
          return this.evaluate(node.body);
        } finally {
          if (previous === undefined) this.scopes.delete(node.scopeId);
          else this.scopes.set(node.scopeId, previous);
        }
      }
      case "Local": {
        const scope = this.scopes.get(node.scopeId);
        if (scope === undefined) throw new Error(`No active scope for '${node.name}'.`);
        return scope.fields.find((f) => f.name === node.name)?.value ?? blank;
      }
      case "FieldAccess": {
        const record = this.evaluate(node.record);
        if (record.kind === "Blank" || record.kind === "Error") return record;
        if (record.kind !== "Record") throw new Error("Field access on a non-record value.");
        return record.fields.find((f) => f.name === node.field)?.value ?? blank;
      }
      case "Invalid":
        throw new Error("Cannot evaluate a formula that failed to bind.");
    }
  }

  /** Evaluates a numeric operand: Blank counts as zero, errors propagate. */
  private operand(node: BoundNode, to: "Number" | "Text" | "Boolean"): FormulaValue {
    return coerceValue(this.evaluate(node), to, this.numeric);
  }

  private unary(node: Extract<BoundNode, { kind: "Unary" }>): FormulaValue {
    const numeric = this.numeric;
    if (node.op === "Not") {
      const value = this.operand(node.operand, "Boolean");
      return value.kind === "Boolean" ? boolean(!value.value) : value;
    }
    const value = this.operand(node.operand, "Number");
    if (value.kind !== "Number") return value;
    if (node.op === "Negate") return number(numeric.negate(value.value));
    const hundred = numeric.parseLiteral("100");
    return hundred === undefined ? error("Numeric") : fromResult(numeric.div(value.value, hundred));
  }

  private binary(node: Extract<BoundNode, { kind: "Binary" }>): FormulaValue {
    const numeric = this.numeric;
    switch (node.op) {
      case "And":
      case "Or": {
        const left = this.operand(node.left, "Boolean");
        if (left.kind !== "Boolean") return left;
        if (node.op === "And" ? !left.value : left.value) return left;
        return this.operand(node.right, "Boolean");
      }
      case "Concat": {
        const left = this.operand(node.left, "Text");
        if (left.kind !== "Text") return left;
        const right = this.operand(node.right, "Text");
        return right.kind === "Text" ? text(left.value + right.value) : right;
      }
      case "Eq":
      case "Neq": {
        const left = this.evaluate(node.left);
        if (left.kind === "Error") return left;
        const right = this.evaluate(node.right);
        if (right.kind === "Error") return right;
        const equal = valuesEqual(left, right, numeric);
        return boolean(node.op === "Eq" ? equal : !equal);
      }
      default: {
        const left = this.operand(node.left, "Number");
        if (left.kind !== "Number") return left;
        const right = this.operand(node.right, "Number");
        if (right.kind !== "Number") return right;
        return numberOperation(node.op, left.value, right.value, numeric);
      }
    }
  }
}

function fromResult(result: NumericResult): FormulaValue {
  return result.ok ? number(result.value) : error(result.kind);
}

function numberOperation(
  op: string,
  a: NumericValue,
  b: NumericValue,
  numeric: NumericBackend,
): FormulaValue {
  switch (op) {
    case "Add":
      return fromResult(numeric.add(a, b));
    case "Sub":
      return fromResult(numeric.sub(a, b));
    case "Mul":
      return fromResult(numeric.mul(a, b));
    case "Div":
      return fromResult(numeric.div(a, b));
    case "Power":
      return fromResult(numeric.pow(a, b));
    case "Lt":
      return boolean(numeric.compare(a, b) < 0);
    case "LtEq":
      return boolean(numeric.compare(a, b) <= 0);
    case "Gt":
      return boolean(numeric.compare(a, b) > 0);
    case "GtEq":
      return boolean(numeric.compare(a, b) >= 0);
    default:
      throw new Error(`Unexpected numeric operator ${op}.`);
  }
}

/**
 * Power Fx 1.0 equality: Blank equals only Blank; text compares case-insensitively.
 * The binder guarantees both operands have the same kind or one is Blank.
 */
function valuesEqual(a: FormulaValue, b: FormulaValue, numeric: NumericBackend): boolean {
  if (a.kind === "Blank" || b.kind === "Blank") return a.kind === b.kind;
  if (a.kind === "Number" && b.kind === "Number") return numeric.compare(a.value, b.value) === 0;
  if (a.kind === "Text" && b.kind === "Text") {
    return a.value.localeCompare(b.value, "en-US", { sensitivity: "accent" }) === 0;
  }
  if (a.kind === "Boolean" && b.kind === "Boolean") return a.value === b.value;
  return false;
}
