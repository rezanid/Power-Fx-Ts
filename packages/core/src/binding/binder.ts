import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
  type DiagnosticCode,
} from "../diagnostics/diagnostic.js";
import { BUILTIN_FUNCTIONS, type FunctionRegistry } from "../functions/signature.js";
import type { BoundBinaryOperator, BoundNode, CoercionTarget } from "../ir/bound-tree.js";
import type { ParseResult } from "../parser/parser.js";
import type { BinaryNode, CallNode, ExpressionNode, UnaryNode } from "../syntax/nodes.js";
import type { Span } from "../text/span.js";
import {
  BooleanType,
  NumberType,
  TextType,
  typeName,
  UnknownType,
  type FormulaType,
} from "../types/formula-type.js";

export interface BindOptions {
  readonly functions?: FunctionRegistry;
}

/** A construct the parser accepts but this engine slice cannot bind yet (not a user error). */
export interface UnsupportedFeature {
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
  const binder = new Binder(parsed, options.functions ?? BUILTIN_FUNCTIONS);
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

  constructor(
    private readonly parsed: ParseResult,
    private readonly functions: FunctionRegistry,
  ) {}

  private report(code: DiagnosticCode, span: Span, args: string[] = []): void {
    this.diagnostics.push(createDiagnostic(code, span, args));
  }

  private invalid(span: Span): BoundNode {
    return { kind: "Invalid", span, type: UnknownType };
  }

  private notSupported(feature: string, span: Span): BoundNode {
    this.unsupported.push({ feature, span });
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
      case "Name":
        this.report(DiagnosticCodes.NameNotRecognized, node.span, [node.name]);
        return this.invalid(node.span);
      case "DottedName":
        return this.notSupported("Member access", node.span);
      case "Record":
        return this.notSupported("Record literal", node.span);
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
      // Mirrors upstream's observed matrix: Text only coerces next to a Number operand, and a
      // Boolean left operand short-circuits the check of the right operand.
      const lk = left.type.kind;
      const rk = right.type.kind;
      const bad: BoundNode[] = [];
      if (lk === "Boolean") bad.push(left);
      else if (lk === "Text") {
        bad.push(left);
        if (rk === "Text" || rk === "Boolean") bad.push(right);
      } else if (rk === "Boolean" || (rk === "Text" && lk === "Blank")) bad.push(right);
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

  private bindCall(node: CallNode): BoundNode {
    const name = node.callee.name;
    const signature = this.functions.get(name);
    const args = node.args.map((a) => this.bindExpression(a));
    if (signature === undefined) {
      return this.notSupported(`Function ${name}`, node.callee.span);
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
