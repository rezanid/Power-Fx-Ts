import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
  type DiagnosticCode,
} from "../diagnostics/diagnostic.js";
import { KNOWN_UPSTREAM_ENUMS, KNOWN_UPSTREAM_FUNCTIONS } from "../functions/known-names.js";
import { BUILTIN_FUNCTIONS, type FunctionRegistry } from "../functions/signature.js";
import type { BoundBinaryOperator, BoundNode, CoercionTarget } from "../ir/bound-tree.js";
import type { ParseResult } from "../parser/parser.js";
import type {
  BinaryNode,
  CallNode,
  DottedNameNode,
  ExpressionNode,
  RecordNode,
  UnaryNode,
} from "../syntax/nodes.js";
import type { Span } from "../text/span.js";
import { findVariable, type Schema } from "../types/schema.js";
import {
  BooleanType,
  findField,
  NumberType,
  TextType,
  typeName,
  UnknownType,
  type FormulaType,
  type RecordField,
} from "../types/formula-type.js";

export interface BindOptions {
  readonly functions?: FunctionRegistry;
  /** Names the formula may reference; without it every name is unrecognized. */
  readonly schema?: Schema;
}

/** A construct the parser accepts but this engine slice cannot bind yet (not a user error). */
export interface UnsupportedFeature {
  /** `function`: a known upstream function without an implementation; `construct`: syntax or operator. */
  readonly category: "function" | "construct";
  readonly feature: string;
  readonly span: Span;
}

export interface BindResult {
  readonly root: BoundNode;
  readonly type: FormulaType;
  /** Binding errors; parse diagnostics are not repeated here. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Constructs outside the implemented slice. A non-empty list means the result must not be treated
   * as a compatibility verdict in either direction.
   */
  readonly unsupported: readonly UnsupportedFeature[];
}

const ARITHMETIC: Readonly<Record<string, BoundBinaryOperator>> = {
  Add: "Add",
  Sub: "Sub",
  Mul: "Mul",
  Div: "Div",
  Power: "Power",
};
const ORDERING: Readonly<Record<string, BoundBinaryOperator>> = {
  Lt: "Lt",
  LtEq: "LtEq",
  Gt: "Gt",
  GtEq: "GtEq",
};

export function bind(parsed: ParseResult, options: BindOptions = {}): BindResult {
  const binder = new Binder(parsed, options.functions ?? BUILTIN_FUNCTIONS, options.schema);
  const root = binder.bindExpression(parsed.root);
  return {
    root,
    type: root.type,
    diagnostics: binder.diagnostics,
    unsupported: binder.unsupported,
  };
}

class Binder {
  readonly diagnostics: Diagnostic[] = [];
  readonly unsupported: UnsupportedFeature[] = [];
  /** Enclosing `With` scopes, innermost last. `fields` is undefined when the scope failed to bind. */
  private readonly scopes: { id: number; fields: readonly RecordField[] | undefined }[] = [];
  private nextScopeId = 1;

  constructor(
    private readonly parsed: ParseResult,
    private readonly functions: FunctionRegistry,
    private readonly schema: Schema | undefined,
  ) {}

  private report(code: DiagnosticCode, span: Span, args: string[] = []): void {
    this.diagnostics.push(createDiagnostic(code, span, args));
  }

  private invalid(span: Span): BoundNode {
    return { kind: "Invalid", span, type: UnknownType };
  }

  private notSupported(
    feature: string,
    span: Span,
    category: UnsupportedFeature["category"] = "construct",
  ): BoundNode {
    this.unsupported.push({ category, feature, span });
    return this.invalid(span);
  }

  /** The operator token between the operands, for diagnostics that point at the operator. */
  private operatorSpan(node: BinaryNode): Span {
    const token = this.parsed.tokens.find(
      (t) => t.span.start >= node.left.span.end && t.kind !== "Whitespace" && t.kind !== "Comment",
    );
    return token?.span ?? node.span;
  }

  private coerce(
    node: BoundNode,
    to: CoercionTarget | undefined,
    preserveBlank = false,
  ): BoundNode {
    if (to === undefined || node.type.kind === to || node.type.kind === "Unknown") return node;
    if (node.type.kind === "Record") {
      this.report(DiagnosticCodes.BadTypeExpected, node.span, [to, "Record"]);
      return this.invalid(node.span);
    }
    const type = to === "Number" ? NumberType : to === "Text" ? TextType : BooleanType;
    const coerced: BoundNode = { kind: "Coerce", to, operand: node, span: node.span, type };
    return preserveBlank ? { ...coerced, preserveBlank } : coerced;
  }

  bindExpression(node: ExpressionNode): BoundNode {
    switch (node.kind) {
      case "NumberLiteral":
        return { kind: "NumberLiteral", text: node.text, span: node.span, type: NumberType };
      case "StringLiteral":
        return { kind: "TextLiteral", value: node.value, span: node.span, type: TextType };
      case "BooleanLiteral":
        return { kind: "BooleanLiteral", value: node.value, span: node.span, type: BooleanType };
      case "Group":
        return this.bindExpression(node.expression);
      case "Unary":
        return this.bindUnary(node);
      case "Binary":
        return this.bindBinary(node);
      case "Call":
        return this.bindCall(node);
      case "Name": {
        const local = this.resolveLocal(node.name, node.span);
        if (local !== undefined) return local;
        const variable = this.schema && findVariable(this.schema, node.name);
        if (variable === undefined || variable === null) {
          this.report(DiagnosticCodes.NameNotRecognized, node.span, [node.name]);
          return this.invalid(node.span);
        }
        return { kind: "Variable", name: variable.name, span: node.span, type: variable.type };
      }
      case "DottedName":
        return this.bindDotted(node);
      case "Record":
        return this.bindRecord(node);
      case "Table":
        return this.notSupported("Table literal", node.span);
      case "Chain":
        return this.notSupported("Expression chaining", node.span);
      case "Missing":
      case "Error":
        // Already reported by the parser.
        return this.invalid(node.span);
    }
  }

  /**
   * Innermost `With` scope field of that exact (case-sensitive) name wins over outer scopes and
   * schema variables. `undefined` means "not a scope name"; an invalid node means the name is
   * hidden by a scope that failed to bind (its diagnostics are already reported).
   */
  private resolveLocal(name: string, span: Span): BoundNode | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!;
      if (scope.fields === undefined) return this.invalid(span);
      const field = scope.fields.find((f) => f.name === name);
      if (field !== undefined) {
        return { kind: "Local", scopeId: scope.id, name, span, type: field.type };
      }
    }
    if (name === "ThisRecord" && this.scopes.length > 0 && !this.isSchemaName(name)) {
      return this.notSupported("ThisRecord (row scope)", span);
    }
    return undefined;
  }

  private isSchemaName(name: string): boolean {
    return this.schema !== undefined && findVariable(this.schema, name) !== undefined;
  }

  /**
   * Upstream `PostVisit(RecordNode)`: field types are the types of their values, duplicate names
   * are an error, and a failed field makes the literal invalid (upstream keeps an Error-typed
   * field; the difference only affects follow-on diagnostics).
   */
  private bindRecord(node: RecordNode): BoundNode {
    const fields: { name: string; value: BoundNode }[] = [];
    const seen = new Set<string>();
    let failed = false;
    for (const field of node.fields) {
      const value = this.bindExpression(field.value);
      if (field.name.kind === "Missing" || value.type.kind === "Unknown") {
        failed = true;
        continue;
      }
      if (seen.has(field.name.name)) {
        this.report(DiagnosticCodes.DuplicateField, field.value.span, [field.name.name]);
        failed = true;
        continue;
      }
      seen.add(field.name.name);
      fields.push({ name: field.name.name, value });
    }
    if (failed) return this.invalid(node.span);
    return {
      kind: "Record",
      fields,
      span: node.span,
      // Upstream normalizes record literal fields by (ordinal) name in the type.
      type: {
        kind: "Record",
        fields: fields
          .map((f) => ({ name: f.name, type: f.value.type }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      },
    };
  }

  private bindWith(node: CallNode): BoundNode {
    const [scopeArg, bodyArg] = node.args;
    if (node.args.length !== 2 || scopeArg === undefined || bodyArg === undefined) {
      node.args.forEach((a) => this.bindExpression(a));
      this.report(DiagnosticCodes.BadArity, node.span, [String(node.args.length), "2"]);
      return this.invalid(node.span);
    }
    // The first argument resolves against the enclosing scopes, not the one it creates.
    const scope = this.bindExpression(scopeArg);
    let fields: readonly RecordField[] | undefined;
    if (scope.type.kind === "Record") fields = scope.type.fields;
    else if (scope.type.kind === "Blank") fields = [];
    else if (scope.type.kind !== "Unknown") {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["With"]);
      this.report(DiagnosticCodes.BadTypeExpected, scopeArg.span, ["Record", typeName(scope.type)]);
    }
    const id = this.nextScopeId++;
    this.scopes.push({ id, fields });
    const body = this.bindExpression(bodyArg);
    this.scopes.pop();
    if (fields === undefined || body.type.kind === "Unknown") return this.invalid(node.span);
    return { kind: "With", scopeId: id, scope, body, span: node.span, type: body.type };
  }

  /**
   * Mirrors upstream `Binder.PostVisit(DottedNameNode)`: errors are reported from the dot to the
   * end of the member name. A left side that already failed to bind is reported as an `Error`
   * value, as upstream does.
   */
  private bindDotted(node: DottedNameNode): BoundNode {
    // Built-in upstream enums are not modelled; other unknown roots fall through to the normal
    // unknown-name diagnostic.
    if (
      node.left.kind === "Name" &&
      !this.isSchemaName(node.left.name) &&
      !this.scopes.some(
        (s) =>
          s.fields === undefined ||
          s.fields.some((f) => f.name === (node.left as { name: string }).name),
      ) &&
      KNOWN_UPSTREAM_ENUMS.has(node.left.name)
    ) {
      return this.notSupported(`Member access on '${node.left.name}'`, node.span);
    }
    const left = this.bindExpression(node.left);
    if (node.right.kind === "Missing") return this.invalid(node.span);
    const span = { start: node.dot.start, end: node.right.span.end };
    if (left.type.kind === "Unknown") {
      this.report(DiagnosticCodes.InvalidDot, span, ["Error"]);
      return this.invalid(node.span);
    }
    if (left.type.kind !== "Record") {
      this.report(DiagnosticCodes.InvalidDot, span, [typeName(left.type)]);
      return this.invalid(node.span);
    }
    const field = findField(left.type, node.right.name);
    if (field === undefined) {
      this.report(DiagnosticCodes.NameNotRecognized, span, [node.right.name]);
      return this.invalid(node.span);
    }
    return {
      kind: "FieldAccess",
      record: left,
      field: field.name,
      span: node.span,
      type: field.type,
    };
  }

  private bindUnary(node: UnaryNode): BoundNode {
    const operand = this.bindExpression(node.operand);
    if (operand.type.kind === "Unknown") return this.invalid(node.span);
    const target: CoercionTarget = node.op === "Not" ? "Boolean" : "Number";
    return {
      kind: "Unary",
      op: node.op,
      operand: this.coerce(operand, target),
      span: node.span,
      type: target === "Boolean" ? BooleanType : NumberType,
    };
  }

  private bindBinary(node: BinaryNode): BoundNode {
    const left = this.bindExpression(node.left);
    const right = this.bindExpression(node.right);
    const op = node.op;
    if (left.type.kind === "Unknown" || right.type.kind === "Unknown") {
      return this.invalid(node.span);
    }

    const arithmetic = ARITHMETIC[op];
    if (arithmetic !== undefined) {
      return this.binary(
        arithmetic,
        this.coerce(left, "Number"),
        this.coerce(right, "Number"),
        node,
        NumberType,
      );
    }
    const ordering = ORDERING[op];
    if (ordering !== undefined) {
      // Mirrors upstream BinderUtils.CheckComparisonArgTypesCore: each operand is checked on its
      // own against Number/Decimal/Date/Time/DateTime/Dynamic, so Text and Boolean are rejected.
      const bad = [left, right].filter(
        (o) => o.type.kind === "Boolean" || o.type.kind === "Text" || o.type.kind === "Record",
      );
      for (const operand of bad) {
        this.report(DiagnosticCodes.InvalidArgumentType, operand.span, []);
      }
      if (bad.length > 0) return this.invalid(node.span);
      return this.binary(
        ordering,
        this.coerce(left, "Number"),
        this.coerce(right, "Number"),
        node,
        BooleanType,
      );
    }

    switch (op) {
      case "Concat":
        return this.binary(
          "Concat",
          this.coerce(left, "Text"),
          this.coerce(right, "Text"),
          node,
          TextType,
        );
      case "And":
      case "Or":
        return this.binary(
          op,
          this.coerce(left, "Boolean"),
          this.coerce(right, "Boolean"),
          node,
          BooleanType,
        );
      case "Eq":
      case "Neq": {
        const lk = left.type.kind;
        const rk = right.type.kind;
        if (lk === "Record" || rk === "Record") {
          // Upstream record equality has its own rules, not yet traced or implemented.
          return this.notSupported("Record comparison", node.span);
        }
        if (lk !== rk && lk !== "Blank" && rk !== "Blank") {
          this.report(DiagnosticCodes.IncompatibleTypesForComparison, this.operatorSpan(node), [
            typeName(left.type),
            typeName(right.type),
          ]);
          return this.invalid(node.span);
        }
        return this.binary(op, left, right, node, BooleanType);
      }
      default:
        return this.notSupported(`Operator ${op}`, node.span);
    }
  }

  private binary(
    op: BoundBinaryOperator,
    left: BoundNode,
    right: BoundNode,
    node: BinaryNode,
    type: FormulaType,
  ): BoundNode {
    return { kind: "Binary", op, left, right, span: node.span, type };
  }

  /**
   * Result arguments of `If` must agree. Identical record types are fine; a record mixed with a
   * scalar is upstream's result-type mismatch; differing records need upstream's record union
   * (V1 compat) which is not implemented, so they are unsupported.
   */
  private checkIfRecordResults(args: readonly BoundNode[], node: CallNode): BoundNode | undefined {
    const results = args
      .filter((_, i) => i % 2 === 1 || (args.length % 2 === 1 && i === args.length - 1))
      .map((a) => a.type)
      .filter((t) => t.kind !== "Blank" && t.kind !== "Unknown");
    const records = results.filter((t) => t.kind === "Record");
    if (records.length === 0) return undefined;
    if (records.length !== results.length) {
      this.report(DiagnosticCodes.ResultTypeMismatch, node.span);
      return this.invalid(node.span);
    }
    const first = JSON.stringify(records[0]);
    if (records.some((t) => JSON.stringify(t) !== first)) {
      return this.notSupported("Record type union in If", node.span);
    }
    return undefined;
  }

  private bindCall(node: CallNode): BoundNode {
    const name = node.callee.name;
    if (name === "With" && !this.functions.get(name)) return this.bindWith(node);
    const signature = this.functions.get(name);
    const args = node.args.map((a) => this.bindExpression(a));
    if (signature === undefined) {
      if (KNOWN_UPSTREAM_FUNCTIONS.has(name)) {
        return this.notSupported(`Function ${name}`, node.callee.span, "function");
      }
      this.report(DiagnosticCodes.UnknownFunction, node.span, [name]);
      return this.invalid(node.span);
    }

    const count = args.length;
    if (count < signature.minArgs || count > signature.maxArgs) {
      if (signature.maxArgs === Infinity) {
        this.report(DiagnosticCodes.BadArityMinimum, node.span, [
          String(count),
          String(signature.minArgs),
        ]);
      } else {
        const expected =
          signature.minArgs === signature.maxArgs
            ? String(signature.minArgs)
            : `${signature.minArgs}-${signature.maxArgs}`;
        this.report(DiagnosticCodes.BadArity, node.span, [String(count), expected]);
      }
      return this.invalid(node.span);
    }

    if (args.some((a) => a.type.kind === "Unknown")) {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, [name]);
      return this.invalid(node.span);
    }

    if (name === "If") {
      const mismatch = this.checkIfRecordResults(args, node);
      if (mismatch !== undefined) return mismatch;
    }
    const check = signature.check(args.map((a) => a.type));
    return {
      kind: "Call",
      fn: name,
      args: args.map((a, i) =>
        this.coerce(a, check.coercions[i], check.preserveBlank?.[i] ?? false),
      ),
      span: node.span,
      type: check.returnType,
    };
  }
}
