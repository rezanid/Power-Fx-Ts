import type { BoundNode, CoercionTarget, ConformPlan } from "@powerfx-ts/core";
import { BUILTIN_IMPLEMENTATIONS } from "../functions/builtins.js";
import type { NumericBackend, NumericResult, NumericValue, Numerics } from "../numeric/backend.js";
import {
  EvaluationBudgetExceeded,
  type EvaluationContext,
  type EvaluationOptions,
  type FunctionImplementation,
} from "../runtime/context.js";
import {
  blank,
  boolean,
  decimal,
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
import { coerceValue, convertNumber } from "./coercion.js";

export function evaluate(root: BoundNode, options: EvaluationOptions): FormulaValue {
  return new Evaluator(options).evaluate(root);
}

class Evaluator implements EvaluationContext {
  private steps = 0;
  /** Active row-scope values (`With`, `Filter`) by scope id; ids are unique per scope node. */
  private readonly scopes = new Map<number, RecordValue | BlankValue | ErrorValue>();

  constructor(private readonly options: EvaluationOptions) {}

  get numerics(): Numerics {
    return this.options.numerics;
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
    const numerics = this.numerics;

    switch (node.kind) {
      case "NumberLiteral": {
        if (node.type.kind === "Decimal") {
          const parsed = numerics.decimal.parseLiteral(node.text);
          return parsed === undefined ? error("Numeric") : decimal(parsed);
        }
        const parsed = numerics.float.parseLiteral(node.text);
        return parsed === undefined ? error("Numeric") : number(parsed);
      }
      case "TextLiteral":
        return text(node.value);
      case "BooleanLiteral":
        return boolean(node.value);
      case "Coerce": {
        const operand = this.evaluate(node.operand);
        if (node.preserveBlank && operand.kind === "Blank") return operand;
        return coerceValue(operand, node.to, numerics);
      }
      case "ConvertNumber": {
        return convertNumber(this.evaluate(node.operand), node.to, numerics);
      }
      case "Conform":
        return this.conform(this.evaluate(node.operand), node.plan);
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
      case "First": {
        const source = this.evaluate(node.source);
        if (source.kind === "Error" || source.kind === "Blank") return source;
        if (source.kind !== "Table") throw new Error("First source is not a table.");
        return source.rows[0] ?? blank;
      }
      case "CountRows": {
        const source = this.evaluate(node.source);
        if (source.kind === "Error") return source;
        if (source.kind === "Blank") return this.count(0, node.type.kind);
        if (source.kind !== "Table") throw new Error("CountRows source is not a table.");
        for (const row of source.rows) {
          this.tick();
          if (row.kind === "Error") return row;
        }
        return this.count(source.rows.length, node.type.kind);
      }
      case "LookUp":
        return this.lookUp(node);
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

  private count(n: number, kind: string): FormulaValue {
    const decimalResult = kind === "Decimal";
    const backend = decimalResult ? this.numerics.decimal : this.numerics.float;
    const value = backend.fromNumber(n);
    if (value === undefined) return error("Numeric");
    return decimalResult ? decimal(value) : number(value);
  }

  /**
   * Upstream `LookUp` shares `LazyFilterAsync`: the predicate runs for every row (no
   * short-circuit), then the first kept row is used, error rows included. The projection runs once,
   * in that row's scope, error and Blank rows included. Upstream passes the null `row.Value` of
   * such rows as the scope and throws a NullReferenceException when the projection reads it; here
   * the scope value is the error (or Blank) itself, as for `Filter` predicates (ADR 0007).
   */
  private lookUp(node: Extract<BoundNode, { kind: "LookUp" }>): FormulaValue {
    const source = this.evaluate(node.source);
    if (source.kind === "Error" || source.kind === "Blank") return source;
    if (source.kind !== "Table") throw new Error("LookUp source is not a table.");
    let found: TableRow | undefined;
    for (const row of source.rows) {
      this.tick();
      const verdict = this.inScope(node.scopeId, row, () => this.evaluate(node.predicate));
      if (found !== undefined) continue;
      if (verdict.kind === "Error") found = verdict;
      else if (verdict.kind === "Boolean" && verdict.value) found = row;
    }
    if (found === undefined) return blank;
    if (node.projection === undefined) return found;
    const projection = node.projection;
    return this.inScope(node.scopeId, found, () => this.evaluate(projection));
  }

  /**
   * Table construction. Record arguments become rows (Blank-filled to the table's row type), an
   * untyped Blank becomes a Blank row, table arguments are spliced in, and an error table argument
   * is the result (upstream `Table.txt`).
   */
  private table(node: Extract<BoundNode, { kind: "Table" }>): FormulaValue {
    const rows: TableRow[] = [];
    for (const item of node.items) {
      const value = this.evaluate(item.value);
      if (item.shape === "row") {
        if (value.kind === "Record") rows.push(value);
        else if (value.kind === "Blank" || value.kind === "Error") rows.push(value);
        else throw new Error("Table row is not a record.");
      } else {
        if (value.kind === "Error") return value;
        if (value.kind === "Blank") continue;
        if (value.kind !== "Table") throw new Error("Table argument is not a table.");
        for (const row of value.rows) {
          this.tick();
          rows.push(row);
        }
      }
    }
    return table(rows);
  }

  /** Applies a binder-produced union plan; errors and Blank pass through untouched. */
  private conform(value: FormulaValue, plan: ConformPlan): FormulaValue {
    if (value.kind === "Error" || value.kind === "Blank") return value;
    switch (plan.kind) {
      case "Scalar":
        return coerceValue(value, plan.to, this.numerics);
      case "Record": {
        if (value.kind !== "Record") throw new Error("Conform expects a record.");
        const byName = new Map(value.fields.map((f) => [f.name, f.value]));
        return record(
          plan.fields.map((f) => {
            const current = f.missing === true ? blank : (byName.get(f.name) ?? blank);
            return {
              name: f.name,
              value: f.plan === undefined ? current : this.conform(current, f.plan),
            };
          }),
        );
      }
      case "Table": {
        if (value.kind !== "Table") throw new Error("Conform expects a table.");
        const rows: TableRow[] = [];
        for (const row of value.rows) {
          this.tick();
          rows.push(row.kind === "Record" ? (this.conform(row, plan.row) as TableRow) : row);
        }
        return table(rows);
      }
    }
  }

  /** Evaluates a numeric operand: Blank counts as zero, errors propagate. */
  private operand(node: BoundNode, to: CoercionTarget): FormulaValue {
    return coerceValue(this.evaluate(node), to, this.numerics);
  }

  private unary(node: Extract<BoundNode, { kind: "Unary" }>): FormulaValue {
    if (node.op === "Not") {
      const value = this.operand(node.operand, "Boolean");
      return value.kind === "Boolean" ? boolean(!value.value) : value;
    }
    const kind = node.type.kind === "Decimal" ? "Decimal" : "Number";
    const numeric = kind === "Decimal" ? this.numerics.decimal : this.numerics.float;
    const value = this.operand(node.operand, kind);
    if (value.kind !== kind) return value;
    if (node.op === "Negate") return wrapNumeric(kind, numeric.negate(value.value));
    const hundred = numeric.parseLiteral("100");
    return hundred === undefined
      ? error("Numeric")
      : fromResult(kind, numeric.div(value.value, hundred));
  }

  private binary(node: Extract<BoundNode, { kind: "Binary" }>): FormulaValue {
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
        const equal = valuesEqual(left, right, this.numerics);
        return boolean(node.op === "Eq" ? equal : !equal);
      }
      default: {
        const kind = node.numeric;
        if (kind === undefined) throw new Error(`Binary ${node.op} has no numeric kind.`);
        const left = this.operand(node.left, kind);
        if (left.kind !== kind) return left;
        const right = this.operand(node.right, kind);
        if (right.kind !== kind) return right;
        const backend = kind === "Decimal" ? this.numerics.decimal : this.numerics.float;
        return numberOperation(node.op, kind, left.value, right.value, backend);
      }
    }
  }
}

const wrapNumeric = (kind: "Number" | "Decimal", value: NumericValue): FormulaValue =>
  kind === "Decimal" ? decimal(value) : number(value);

function fromResult(kind: "Number" | "Decimal", result: NumericResult): FormulaValue {
  return result.ok ? wrapNumeric(kind, result.value) : error(result.kind);
}

function numberOperation(
  op: string,
  kind: "Number" | "Decimal",
  a: NumericValue,
  b: NumericValue,
  numeric: NumericBackend,
): FormulaValue {
  switch (op) {
    case "Add":
      return fromResult(kind, numeric.add(a, b));
    case "Sub":
      return fromResult(kind, numeric.sub(a, b));
    case "Mul":
      return fromResult(kind, numeric.mul(a, b));
    case "Div":
      return fromResult(kind, numeric.div(a, b));
    case "Power":
      return fromResult(kind, numeric.pow(a, b));
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
function valuesEqual(a: FormulaValue, b: FormulaValue, numerics: Numerics): boolean {
  if (a.kind === "Blank" || b.kind === "Blank") return a.kind === b.kind;
  if (a.kind === "Number" && b.kind === "Number") {
    return numerics.float.compare(a.value, b.value) === 0;
  }
  if (a.kind === "Decimal" && b.kind === "Decimal") {
    return numerics.decimal.compare(a.value, b.value) === 0;
  }
  if (a.kind === "Text" && b.kind === "Text") {
    return a.value.localeCompare(b.value, "en-US", { sensitivity: "accent" }) === 0;
  }
  if (a.kind === "Boolean" && b.kind === "Boolean") return a.value === b.value;
  return false;
}
