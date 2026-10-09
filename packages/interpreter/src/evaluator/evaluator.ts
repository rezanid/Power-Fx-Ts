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
  table,
  text,
  type BlankValue,
  type ErrorValue,
  type FormulaValue,
  type RecordValue,
  type TableRow,
} from "../values/values.js";
import { coerceValue } from "./coercion.js";

export function evaluate(root: BoundNode, options: EvaluationOptions): FormulaValue {
  return new Evaluator(options).evaluate(root);
}

class Evaluator implements EvaluationContext {
  private steps = 0;
  /** Active row-scope values (`With`, `Filter`) by scope id; ids are unique per scope node. */
  private readonly scopes = new Map<number, RecordValue | BlankValue | ErrorValue>();

  constructor(private readonly options: EvaluationOptions) {}

  get numeric(): NumericBackend {
    return this.options.numeric;
  }

  /** Cancellation and budget check; one step per node and per table row visited. */
  private tick(): void {
    this.options.signal?.throwIfAborted();
    if (this.options.maxSteps !== undefined && ++this.steps > this.options.maxSteps) {
      throw new EvaluationBudgetExceeded();
    }
  }

  evaluate(node: BoundNode): FormulaValue {
    this.tick();
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
        // Upstream keeps source order in the value (an insertion-ordered dictionary); only the
        // type (ordinal-sorted tree) and `ToExpression` serialization sort by name.
        return record(node.fields.map((f) => ({ name: f.name, value: this.evaluate(f.value) })));
      }
      case "With": {
        const scope = this.evaluate(node.scope);
        if (scope.kind === "Error" || scope.kind === "Blank") return scope;
        if (scope.kind !== "Record") throw new Error("With scope is not a record.");
        return this.inScope(node.scopeId, scope, () => this.evaluate(node.body));
      }
      case "Local": {
        const scope = this.scopes.get(node.scopeId);
        if (scope === undefined) throw new Error(`No active scope for '${node.name}'.`);
        // Upstream FormulaValueScope.Resolve: a non-record scope value is returned for any name.
        if (scope.kind !== "Record") return scope;
        return scope.fields.find((f) => f.name === node.name)?.value ?? blank;
      }
      case "ScopeRecord": {
        const scope = this.scopes.get(node.scopeId);
        if (scope === undefined) throw new Error("No active row scope.");
        return scope;
      }
      case "Table":
        return this.table(node);
      case "Filter":
        return this.filter(node);
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

  private inScope<T>(id: number, value: RecordValue | BlankValue | ErrorValue, run: () => T): T {
    const previous = this.scopes.get(id);
    this.scopes.set(id, value);
    try {
      return run();
    } finally {
      if (previous === undefined) this.scopes.delete(id);
      else this.scopes.set(id, previous);
    }
  }

  /**
   * Upstream `LazyFilterRowAsync`: the predicate runs for every row, including error rows (whose
   * scope value is the error itself). True keeps the row, false/Blank drops it, an error becomes an
   * error row.
   */
  private filter(node: Extract<BoundNode, { kind: "Filter" }>): FormulaValue {
    const source = this.evaluate(node.source);
    if (source.kind === "Error" || source.kind === "Blank") return source;
    if (source.kind !== "Table") throw new Error("Filter source is not a table.");
    const rows: TableRow[] = [];
    for (const row of source.rows) {
      this.tick();
      const verdict = this.inScope(node.scopeId, row, () => this.evaluate(node.predicate));
      if (verdict.kind === "Error") rows.push(verdict);
      else if (verdict.kind === "Boolean" && verdict.value) rows.push(row);
    }
    return table(rows);
  }

  /**
   * Table construction. Record arguments become rows (Blank-filled to the table's row type), an
   * untyped Blank becomes a Blank row, table arguments are spliced in, and an error table argument
   * is the result (upstream `Table.txt`).
   */
  private table(node: Extract<BoundNode, { kind: "Table" }>): FormulaValue {
    const names = node.type.kind === "Table" ? node.type.row.fields.map((f) => f.name) : [];
    const conform = (row: TableRow): TableRow => {
      if (row.kind !== "Record" || row.fields.length === names.length) return row;
      // Filling follows the table row type's (ordinal) field order, so unioned rows are uniform.
      const byName = new Map(row.fields.map((f) => [f.name, f.value]));
      return record(names.map((name) => ({ name, value: byName.get(name) ?? blank })));
    };
    const rows: TableRow[] = [];
    for (const item of node.items) {
      const value = this.evaluate(item.value);
      if (item.shape === "row") {
        if (value.kind === "Record") rows.push(conform(value));
        else if (value.kind === "Blank" || value.kind === "Error") rows.push(value);
        else throw new Error("Table row is not a record.");
      } else {
        if (value.kind === "Error") return value;
        if (value.kind === "Blank") continue;
        if (value.kind !== "Table") throw new Error("Table argument is not a table.");
        for (const row of value.rows) {
          this.tick();
          rows.push(conform(row));
        }
      }
    }
    return table(rows);
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
