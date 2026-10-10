import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
  type DiagnosticCode,
} from "../diagnostics/diagnostic.js";
import { KNOWN_UPSTREAM_ENUMS, KNOWN_UPSTREAM_FUNCTIONS } from "../functions/known-names.js";
import { BUILTIN_FUNCTIONS, foldCoalesce, type FunctionRegistry } from "../functions/signature.js";
import { conformPlan, unionRecords, unionTypes } from "../types/union.js";
import type {
  BoundBinaryOperator,
  BoundNode,
  CoercionTarget,
  NumericKind,
} from "../ir/bound-tree.js";
import type { ParseResult } from "../parser/parser.js";
import type {
  AsNode,
  BinaryNode,
  CallNode,
  DottedNameNode,
  ExpressionNode,
  RecordNode,
  TableNode,
  UnaryNode,
} from "../syntax/nodes.js";
import type { Span } from "../text/span.js";
import { findVariable, type Schema } from "../types/schema.js";
import {
  BooleanType,
  DecimalType,
  findField,
  NumberType,
  TextType,
  typeName,
  UnknownType,
  type FormulaType,
  type RecordField,
  type RecordTypeOf,
  tableType,
} from "../types/formula-type.js";

export interface BindOptions {
  readonly functions?: FunctionRegistry;
  /** Names the formula may reference; without it every name is unrecognized. */
  readonly schema?: Schema;
  /**
   * Literal and operator typing: `float` (default) types numeric literals as Number (upstream
   * `NumberIsFloat`); `decimal` types them as Decimal.
   */
  readonly numberMode?: "float" | "decimal";
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

// Accepted-type lists of upstream's operand checks (BinderUtils.CheckBinaryOpCore/CheckUnaryOpCore),
// as printed by the pinned reference. Number and Decimal fold into "Number".
const ARITHMETIC_TYPES = "Number, Text, Boolean, Date, Time, DateTimeNoTimeZone, DateTime, Dynamic";
const NUMERIC_TYPES = "Number, Text, Boolean, Dynamic";
const BOOLEAN_TYPES = "Boolean, Number, Text, Dynamic";
const CONCAT_TYPES =
  "Text, GUID, Number, Date, Time, DateTimeNoTimeZone, DateTime, Boolean, ViewValue, Dynamic";
const UNARY_ACCEPTED: Readonly<Record<UnaryNode["op"], string>> = {
  Negate: NUMERIC_TYPES,
  Not: BOOLEAN_TYPES,
  Percent: "Number, Date, DateTime, DateTimeNoTimeZone, Time, Text, Boolean, Dynamic",
};
/** Left and right operand lists; ordering operators use their own (shared) message. */
const BINARY_ACCEPTED: Readonly<Record<string, readonly [string, string]>> = {
  Add: [ARITHMETIC_TYPES, ARITHMETIC_TYPES],
  Sub: [ARITHMETIC_TYPES, NUMERIC_TYPES],
  Mul: [ARITHMETIC_TYPES, ARITHMETIC_TYPES],
  Div: [ARITHMETIC_TYPES, ARITHMETIC_TYPES],
  Power: [NUMERIC_TYPES, NUMERIC_TYPES],
  Concat: [CONCAT_TYPES, CONCAT_TYPES],
  And: [BOOLEAN_TYPES, BOOLEAN_TYPES],
  Or: [BOOLEAN_TYPES, BOOLEAN_TYPES],
  Lt: ["", ""],
  LtEq: ["", ""],
  Gt: ["", ""],
  GtEq: ["", ""],
};

const TARGET_TYPES: Readonly<Record<CoercionTarget, FormulaType>> = {
  Number: NumberType,
  Decimal: DecimalType,
  Text: TextType,
  Boolean: BooleanType,
};

export function bind(parsed: ParseResult, options: BindOptions = {}): BindResult {
  const binder = new Binder(
    parsed,
    options.functions ?? BUILTIN_FUNCTIONS,
    options.schema,
    options.numberMode ?? "float",
  );
  const root = binder.bindExpression(parsed.root);
  return {
    root,
    type: root.type,
    diagnostics: binder.diagnostics,
    unsupported: binder.unsupported,
  };
}

/**
 * A row scope, as upstream `Binder.Scope`. `fields` is undefined when the scope's source failed to
 * bind. Without `As` the whole row is `ThisRecord` and its fields are also in scope by name; with
 * `As alias` only the alias names the row (upstream `RequireScopeIdentifier`).
 */
interface Scope {
  readonly id: number;
  readonly fields: readonly RecordField[] | undefined;
  readonly identifier: string;
  readonly requireIdentifier: boolean;
}

class Binder {
  readonly diagnostics: Diagnostic[] = [];
  readonly unsupported: UnsupportedFeature[] = [];
  /** Enclosing row scopes (`With`, `Filter`), innermost last. */
  private readonly scopes: Scope[] = [];
  private nextScopeId = 1;

  constructor(
    private readonly parsed: ParseResult,
    private readonly functions: FunctionRegistry,
    private readonly schema: Schema | undefined,
    private readonly numberMode: "float" | "decimal",
  ) {}

  private get defaultNumeric(): NumericKind {
    return this.numberMode === "decimal" ? "Decimal" : "Number";
  }

  /**
   * Upstream `BinderUtils.CheckDecimalBinaryOp`: with `NumberIsFloat` the result is Decimal only
   * when both operands are Decimal; without it the result is Number (float) when either operand is
   * Number, else Decimal. Non-numeric operands coerce to the result kind.
   */
  private numericKind(left: FormulaType, right: FormulaType): NumericKind {
    if (this.numberMode === "float") {
      return left.kind === "Decimal" && right.kind === "Decimal" ? "Decimal" : "Number";
    }
    return left.kind === "Number" || right.kind === "Number" ? "Number" : "Decimal";
  }

  /** Unary `-` and `%`: the operand's own numeric kind, else the mode's default. */
  private unaryKind(operand: FormulaType): NumericKind {
    return operand.kind === "Number" || operand.kind === "Decimal"
      ? operand.kind
      : this.defaultNumeric;
  }

  private report(code: DiagnosticCode, span: Span, args: string[] = []): void {
    this.diagnostics.push(createDiagnostic(code, span, args));
  }

  private isErrorTyped(node: BoundNode): boolean {
    return node.kind === "Invalid" && node.errorTyped === true;
  }

  /**
   * Upstream gives an out-of-range literal the type Error and every consumer then rejects it with
   * its own message (`CheckTypeCore`: "Expecting one of the following: ..." with the operator's
   * accepted types, listed here as verified against the reference). Errors do not propagate
   * further: the enclosing operator or call yields a well-typed result.
   */
  private reportErrorOperand(operand: BoundNode, accepted: string): void {
    this.report(DiagnosticCodes.InvalidArgumentTypeOneOf, operand.span, [accepted]);
  }

  /** Upstream keeps the operator's or function's result type after an operand error. */
  private recovered(span: Span, type: FormulaType): BoundNode {
    return { kind: "Invalid", span, type };
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

  /** Upstream `GetTextSpan`: binary expressions are reported at their operator token. */
  private textSpan(node: ExpressionNode): Span {
    return node.kind === "Binary" ? this.operatorSpan(node) : node.span;
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
    emptyTextAsBlank = false,
  ): BoundNode {
    if (to === undefined || node.type.kind === to || node.type.kind === "Unknown") return node;
    if (node.type.kind === "Record" || node.type.kind === "Table") {
      this.report(DiagnosticCodes.BadTypeExpected, node.span, [to, node.type.kind]);
      return this.invalid(node.span);
    }
    const type = TARGET_TYPES[to];
    const coerced: BoundNode = { kind: "Coerce", to, operand: node, span: node.span, type };
    if (!preserveBlank) return coerced;
    return emptyTextAsBlank
      ? { ...coerced, preserveBlank, emptyTextAsBlank }
      : { ...coerced, preserveBlank };
  }

  bindExpression(node: ExpressionNode): BoundNode {
    switch (node.kind) {
      case "NumberLiteral":
        return {
          kind: "NumberLiteral",
          text: node.text,
          span: node.span,
          type: this.numberMode === "decimal" ? DecimalType : NumberType,
        };
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
        return this.bindTableLiteral(node);
      case "As":
        // Upstream only allows `As` as a direct argument of a function that creates a row scope
        // (or as a control's top-level formula, which has no equivalent here).
        this.bindExpression(node.left);
        this.report(DiagnosticCodes.AsNotInContext, node.span);
        return this.invalid(node.span);
      case "Chain":
        return this.notSupported("Expression chaining", node.span);
      case "Missing":
        return this.invalid(node.span);
      case "Error":
        // Already reported by the parser. An out-of-range numeric literal still has the type
        // Error, so the construct around it reports its own cascaded diagnostics.
        return node.numberTooLarge === true
          ? { kind: "Invalid", span: node.span, type: UnknownType, errorTyped: true }
          : this.invalid(node.span);
    }
  }

  /**
   * Mirrors upstream `IsRowScopeField`: innermost row scope first; a field is found by name unless
   * the scope requires its `As` identifier, and the scope identifier names the whole row. An invalid
   * node means the name is hidden by a scope that failed to bind (already reported).
   */
  private resolveLocal(name: string, span: Span): BoundNode | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!;
      if (scope.fields === undefined) return this.invalid(span);
      if (!scope.requireIdentifier) {
        const field = scope.fields.find((f) => f.name === name);
        if (field !== undefined) {
          return { kind: "Local", scopeId: scope.id, name, span, type: field.type };
        }
      }
      if (scope.identifier === name) {
        return {
          kind: "ScopeRecord",
          scopeId: scope.id,
          span,
          type: { kind: "Record", fields: scope.fields },
        };
      }
    }
    return undefined;
  }

  private isScopeName(name: string): boolean {
    return this.scopes.some(
      (s) =>
        s.fields === undefined ||
        s.identifier === name ||
        (!s.requireIdentifier && s.fields.some((f) => f.name === name)),
    );
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

  /** A row-scope source argument, optionally renamed with `As` (upstream `GetScopeIdent`). */
  private bindScopeSource(arg: ExpressionNode): { source: BoundNode; alias: string | undefined } {
    if (arg.kind !== "As") return { source: this.bindExpression(arg), alias: undefined };
    const asNode: AsNode = arg;
    const source = this.bindExpression(asNode.left);
    return { source, alias: asNode.name.kind === "Name" ? asNode.name.name : undefined };
  }

  private bindWith(node: CallNode): BoundNode {
    const [scopeArg, bodyArg] = node.args;
    if (node.args.length !== 2 || scopeArg === undefined || bodyArg === undefined) {
      node.args.forEach((a) => this.bindExpression(a));
      this.report(DiagnosticCodes.BadArity, node.span, [String(node.args.length), "2"]);
      return this.invalid(node.span);
    }
    // The first argument resolves against the enclosing scopes, not the one it creates.
    const { source: scope, alias } = this.bindScopeSource(scopeArg);
    let fields: readonly RecordField[] | undefined;
    if (scope.type.kind === "Record") fields = scope.type.fields;
    else if (scope.type.kind === "Blank") fields = [];
    else if (scope.type.kind !== "Unknown") {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["With"]);
      this.report(DiagnosticCodes.BadTypeExpected, scopeArg.span, ["Record", typeName(scope.type)]);
    }
    const id = this.nextScopeId++;
    const body = this.withScope(id, fields, alias, () => this.bindExpression(bodyArg));
    if (fields === undefined || body.type.kind === "Unknown") return this.invalid(node.span);
    return { kind: "With", scopeId: id, scope, body, span: node.span, type: body.type };
  }

  private withScope<T>(
    id: number,
    fields: readonly RecordField[] | undefined,
    alias: string | undefined,
    bind: () => T,
  ): T {
    this.scopes.push({
      id,
      fields,
      identifier: alias ?? "ThisRecord",
      requireIdentifier: alias !== undefined,
    });
    try {
      return bind();
    } finally {
      this.scopes.pop();
    }
  }

  /**
   * `Filter(source, predicate)`, upstream `FilterFunction`: the source must be a table (an untyped
   * Blank or a record is rejected under V1 rules), the result has the source's row type, and the
   * predicate is bound in the row scope and must be Boolean or coercible to it. V1 allows exactly
   * two arguments.
   */
  private bindFilter(node: CallNode): BoundNode {
    const [sourceArg, predicateArg] = node.args;
    if (node.args.length < 2 || sourceArg === undefined || predicateArg === undefined) {
      node.args.forEach((a) => this.bindExpression(a));
      this.report(DiagnosticCodes.BadArity, node.span, [String(node.args.length), "2"]);
      return this.invalid(node.span);
    }
    const { source, alias } = this.bindScopeSource(sourceArg);
    let fields: readonly RecordField[] | undefined;
    if (source.type.kind === "Table") fields = source.type.row.fields;
    else if (source.type.kind !== "Unknown") {
      if (source.type.kind === "Blank") {
        this.report(DiagnosticCodes.BadType, sourceArg.span);
      } else {
        this.report(DiagnosticCodes.NeedTable, node.span, ["Filter"]);
      }
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["Filter"]);
    }
    const id = this.nextScopeId++;
    if (node.args.length > 2) {
      // V1 rules reject the multi-predicate form; extra arguments are still bound in the row scope.
      this.withScope(id, fields, alias, () => {
        for (const extra of node.args.slice(1)) this.bindExpression(extra);
      });
      if (fields !== undefined) {
        this.report(DiagnosticCodes.FilterOnlyTwoArgs, this.textSpan(node.args[2]!));
        this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["Filter"]);
      }
      return this.invalid(node.span);
    }
    let predicate = this.withScope(id, fields, alias, () => this.bindExpression(predicateArg));
    if (fields === undefined || predicate.type.kind === "Unknown") return this.invalid(node.span);
    if (predicate.type.kind === "Record" || predicate.type.kind === "Table") {
      this.report(DiagnosticCodes.BooleanExpected, predicateArg.span);
      return this.invalid(node.span);
    }
    predicate = this.coerce(predicate, "Boolean");
    return { kind: "Filter", scopeId: id, source, predicate, span: node.span, type: source.type };
  }

  /**
   * `LookUp` source that is not a table. Pinned corpus (`Lookup_V1Compat.txt`): an untyped Blank
   * gives `ErrBadType` on the argument plus the invalid-arguments error; other types give only
   * `ErrBadType`. (`Filter` differs, see `bindFilter`.)
   */
  private reportBadLookUpSource(node: CallNode, sourceArg: ExpressionNode, blank: boolean): void {
    this.report(DiagnosticCodes.BadType, sourceArg.span);
    if (blank) {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["LookUp"]);
    }
  }

  /** Binds the single table argument of `First`/`CountRows`; `undefined` after reporting. */
  private bindTableArgument(node: CallNode): BoundNode | undefined {
    const [arg] = node.args;
    if (node.args.length !== 1 || arg === undefined) {
      node.args.forEach((a) => this.bindExpression(a));
      this.report(DiagnosticCodes.BadArity, node.span, [String(node.args.length), "1"]);
      return undefined;
    }
    const source = this.bindExpression(arg);
    if (source.type.kind === "Unknown") {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, [node.callee.name]);
      return undefined;
    }
    if (source.type.kind !== "Table" && source.type.kind !== "Blank") {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, [node.callee.name]);
      this.report(DiagnosticCodes.BadTypeExpected, arg.span, ["Table", typeName(source.type)]);
      return undefined;
    }
    return source;
  }

  /**
   * `Decimal(x[, locale])` / `Float(x[, locale])` / `Value(x[, locale])` (upstream
   * `DecimalFunction`, `FloatFunction`, `ValueFunction`). `Value` yields the formula's default
   * numeric kind. The locale must be Text (or Blank), selecting the culture that parses text; a
   * literal locale outside the supported cultures is reported as unsupported, a computed one is
   * reported at run time. Blank and empty text stay Blank.
   */
  private bindNumericConversion(node: CallNode, name: "Decimal" | "Float" | "Value"): BoundNode {
    const args = node.args.map((a) => this.bindExpression(a));
    if (args.length < 1 || args.length > 2) {
      this.report(DiagnosticCodes.BadArity, node.span, [String(args.length), "1-2"]);
      return this.invalid(node.span);
    }
    const operand = args[0]!;
    const to: NumericKind =
      name === "Value" ? this.defaultNumeric : name === "Decimal" ? "Decimal" : "Number";
    const locale = args[1];
    if (this.isErrorTyped(operand) || (locale !== undefined && this.isErrorTyped(locale))) {
      // Upstream reports each Error-typed argument, then the call itself; the call keeps its type.
      const errors: Diagnostic[] = [];
      if (this.isErrorTyped(operand)) {
        errors.push(createDiagnostic(DiagnosticCodes.TextOrNumberExpected, operand.span));
      }
      if (locale !== undefined && this.isErrorTyped(locale)) {
        errors.push(createDiagnostic(DiagnosticCodes.TextExpected, locale.span));
      }
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, [name]);
      this.diagnostics.push(...errors);
      return this.recovered(node.span, TARGET_TYPES[to]);
    }
    if (operand.type.kind === "Unknown") return this.invalid(node.span);
    if (operand.type.kind === "Record" || operand.type.kind === "Table") {
      this.report(DiagnosticCodes.InvalidArgumentType, operand.span, []);
      return this.invalid(node.span);
    }
    if (locale === undefined) {
      return { kind: "ConvertNumber", to, operand, span: node.span, type: TARGET_TYPES[to] };
    }
    if (locale.type.kind === "Unknown") return this.invalid(node.span);
    if (locale.type.kind !== "Text" && locale.type.kind !== "Blank") {
      this.report(DiagnosticCodes.InvalidArgumentType, locale.span, []);
      return this.invalid(node.span);
    }
    return { kind: "ConvertNumber", to, operand, locale, span: node.span, type: TARGET_TYPES[to] };
  }

  /** `First(table)`, upstream `FirstLastFunction`: the result is a row of the table's type. */
  private bindFirst(node: CallNode): BoundNode {
    const source = this.bindTableArgument(node);
    if (source === undefined) return this.invalid(node.span);
    const type: FormulaType = source.type.kind === "Table" ? source.type.row : source.type;
    return { kind: "First", source, span: node.span, type };
  }

  /** `CountRows(table)`: Decimal without `NumberIsFloat` (verified against the reference), else Number. */
  private bindCountRows(node: CallNode): BoundNode {
    const source = this.bindTableArgument(node);
    if (source === undefined) return this.invalid(node.span);
    return {
      kind: "CountRows",
      source,
      span: node.span,
      type: this.defaultNumeric === "Decimal" ? DecimalType : NumberType,
    };
  }

  /**
   * `LookUp(source, predicate[, projection])`, upstream `LookUpFunction`: arity 2-3; the source
   * must be a table; the predicate must be exactly Boolean (or untyped Blank), without the
   * coercions `Filter` allows; the result is the projection's type, or the source row type.
   */
  private bindLookUp(node: CallNode): BoundNode {
    const [sourceArg, predicateArg, projectionArg] = node.args;
    if (node.args.length < 2 || sourceArg === undefined || predicateArg === undefined) {
      node.args.forEach((a) => this.bindExpression(a));
      this.report(DiagnosticCodes.BadArity, node.span, [String(node.args.length), "2-3"]);
      return this.invalid(node.span);
    }
    const { source, alias } = this.bindScopeSource(sourceArg);
    let fields: readonly RecordField[] | undefined;
    const rowType = source.type.kind === "Table" ? source.type.row : undefined;
    if (source.type.kind === "Table") fields = source.type.row.fields;
    else if (source.type.kind !== "Unknown") {
      this.reportBadLookUpSource(node, sourceArg, source.type.kind === "Blank");
    }
    const id = this.nextScopeId++;
    const inScope = <T>(bind: () => T): T => this.withScope(id, fields, alias, bind);
    let predicate = inScope(() => this.bindExpression(predicateArg));
    const projection =
      projectionArg === undefined ? undefined : inScope(() => this.bindExpression(projectionArg));
    if (node.args.length > 3) {
      // Upstream binds the extra arguments outside the row scope.
      node.args.slice(3).forEach((a) => this.bindExpression(a));
      this.report(DiagnosticCodes.BadArity, node.span, [String(node.args.length), "2-3"]);
      return this.invalid(node.span);
    }
    if (rowType === undefined || fields === undefined || predicate.type.kind === "Unknown") {
      return this.invalid(node.span);
    }
    if (predicate.type.kind !== "Boolean" && predicate.type.kind !== "Blank") {
      this.report(DiagnosticCodes.BooleanExpected, predicateArg.span);
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["LookUp"]);
      return this.invalid(node.span);
    }
    if (predicate.type.kind === "Blank") predicate = this.coerce(predicate, "Boolean");
    if (projection !== undefined && projection.type.kind === "Unknown") {
      return this.invalid(node.span);
    }
    return {
      kind: "LookUp",
      scopeId: id,
      source,
      predicate,
      projection,
      span: node.span,
      type: projection?.type ?? rowType,
    };
  }

  /** Wraps `node` in an explicit `Conform` when its type differs from the union `target`. */
  private conformTo(node: BoundNode, target: FormulaType, emptyTextAsBlank = false): BoundNode {
    const plan = conformPlan(node.type, target);
    if (plan === undefined) return node;
    const conform = {
      kind: "Conform" as const,
      operand: node,
      plan,
      span: node.span,
      type: target,
    };
    return emptyTextAsBlank ? { ...conform, emptyTextAsBlank } : conform;
  }

  /**
   * `Coalesce(arg, ...)`, upstream `CoalesceFunction` under PowerFxV1 rules. `foldCoalesce` types
   * the call and decides each scalar argument's coercion; record and table arguments are then
   * adjusted to the final union (`MaybeAdjustToCompileTimeType`), which equals the fold-time
   * unions because the left type always wins. Every coercion keeps Blank and turns empty text into
   * Blank, so the evaluator can decide on the coerced value.
   */
  private bindCoalesce(node: CallNode, args: readonly BoundNode[]): BoundNode {
    const fold = foldCoalesce(args.map((a) => a.type));
    if (fold.issues.length > 0) {
      for (const issue of fold.issues) {
        const arg = args[issue.index]!;
        const span = this.textSpan(node.args[issue.index]!);
        if (issue.kind === "ErrorTyped") {
          if (this.isErrorTyped(arg)) this.report(DiagnosticCodes.TypeError, span);
        } else {
          this.report(DiagnosticCodes.BadTypeExpected, span, [
            issue.expected === "Error" ? "Error" : typeName(issue.expected),
            typeName(issue.provided),
          ]);
        }
      }
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["Coalesce"]);
      return fold.type === "Error" || fold.type.kind === "Blank"
        ? this.invalid(node.span)
        : this.recovered(node.span, fold.type);
    }
    const type = fold.type as FormulaType;
    return {
      kind: "Call",
      fn: "Coalesce",
      args: args.map((a, i) =>
        a.type.kind === "Record" || a.type.kind === "Table"
          ? this.conformTo(a, type, true)
          : this.coerce(a, fold.coercions[i], true, true),
      ),
      span: node.span,
      type,
    };
  }

  /**
   * Table literal `[a, b, ...]` under PowerFxV1 (`TableSyntaxDoesntWrapRecords`): record items are
   * rows; otherwise scalar items are wrapped as `{Value: item}`. Upstream `PostVisit(TableNode)`.
   */
  private bindTableLiteral(node: TableNode): BoundNode {
    const items = node.items.map((i) => this.bindExpression(i));
    if (items.some((i) => i.type.kind === "Unknown")) return this.invalid(node.span);
    if (items.length === 0) {
      return { kind: "Table", items: [], span: node.span, type: tableType([]) };
    }
    const hasRecord = items.some((i) => i.type.kind === "Record");
    if (!hasRecord && items.every((i) => i.type.kind === "Blank")) {
      return this.notSupported("Table of only Blank values", node.span);
    }
    // Scalar and table items become `{Value: item}` rows; Blank items stay Blank rows beside records.
    const rowOf = (item: BoundNode): BoundNode =>
      hasRecord || item.type.kind === "Record"
        ? item
        : {
            kind: "Record",
            fields: [{ name: "Value", value: item }],
            span: item.span,
            type: { kind: "Record", fields: [{ name: "Value", type: item.type }] },
          };
    let rowType: RecordTypeOf | undefined;
    const rows: BoundNode[] = [];
    for (const [i, item] of items.entries()) {
      if (hasRecord && item.type.kind !== "Record" && item.type.kind !== "Blank") {
        this.report(DiagnosticCodes.TableDoesNotAcceptThisType, node.items[i]!.span);
        return this.invalid(node.span);
      }
      const row = rowOf(item);
      if (row.type.kind === "Record") {
        const union = rowType === undefined ? row.type : unionRecords(rowType, row.type);
        if (union === undefined) {
          this.report(DiagnosticCodes.TableDoesNotAcceptThisType, node.items[i]!.span);
          return this.invalid(node.span);
        }
        rowType = union;
      }
      rows.push(row);
    }
    if (rowType === undefined) return this.notSupported("Table of only Blank values", node.span);
    const target = rowType;
    return {
      kind: "Table",
      items: rows.map((value) => ({ shape: "row" as const, value: this.conformTo(value, target) })),
      span: node.span,
      type: { kind: "Table", row: target },
    };
  }

  /**
   * `Table(arg, ...)`, upstream `TableFunction`: each argument is a record (one row), an untyped
   * Blank (a Blank row) or a table (its rows are spliced in). The row type is the union of the
   * arguments' record types.
   */
  private bindTableCall(node: CallNode): BoundNode {
    const args = node.args.map((a) => this.bindExpression(a));
    if (args.some((a) => a.type.kind === "Unknown")) {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["Table"]);
      return this.invalid(node.span);
    }
    let rowType: RecordTypeOf | undefined;
    const bound: { shape: "row" | "rows"; value: BoundNode }[] = [];
    for (const [i, arg] of args.entries()) {
      if (arg.type.kind === "Blank") {
        bound.push({ shape: "row", value: arg });
        continue;
      }
      if (arg.type.kind !== "Record" && arg.type.kind !== "Table") {
        this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["Table"]);
        this.report(DiagnosticCodes.NeedRecordOrTable, this.textSpan(node.args[i]!));
        return this.invalid(node.span);
      }
      const argRow = arg.type.kind === "Record" ? arg.type : arg.type.row;
      const union = rowType === undefined ? argRow : unionRecords(rowType, argRow);
      if (union === undefined) {
        this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, ["Table"]);
        this.report(DiagnosticCodes.TableDoesNotAcceptThisType, node.args[i]!.span);
        return this.invalid(node.span);
      }
      rowType = union;
      bound.push({ shape: arg.type.kind === "Record" ? "row" : "rows", value: arg });
    }
    const target: RecordTypeOf = rowType ?? { kind: "Record", fields: [] };
    const items = bound.map(({ shape, value }) => ({
      shape,
      value:
        value.type.kind === "Blank"
          ? value
          : this.conformTo(value, shape === "row" ? target : { kind: "Table", row: target }),
    }));
    return { kind: "Table", items, span: node.span, type: { kind: "Table", row: target } };
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
      !this.isScopeName(node.left.name) &&
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
    if (left.type.kind === "Table") {
      // Under PowerFxV1CompatibilityRules upstream rejects `Table.Field` outright (and the
      // interpreter never implemented single-column table access).
      this.report(DiagnosticCodes.DeprecatedDotUseShowColumns, span);
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
    if (
      this.isErrorTyped(operand) ||
      (node.op !== "Percent" && (operand.type.kind === "Record" || operand.type.kind === "Table"))
    ) {
      this.reportErrorOperand(operand, UNARY_ACCEPTED[node.op]);
      return this.recovered(node.span, node.op === "Not" ? BooleanType : NumberType);
    }
    if (operand.type.kind === "Unknown") return this.invalid(node.span);
    const target: CoercionTarget = node.op === "Not" ? "Boolean" : this.unaryKind(operand.type);
    return {
      kind: "Unary",
      op: node.op,
      operand: this.coerce(operand, target),
      span: node.span,
      type: TARGET_TYPES[target],
    };
  }

  private bindBinary(node: BinaryNode): BoundNode {
    const left = this.bindExpression(node.left);
    const right = this.bindExpression(node.right);
    const op = node.op;
    const aggregate = (n: BoundNode): boolean =>
      n.type.kind === "Record" || n.type.kind === "Table";
    if (
      this.isErrorTyped(left) ||
      this.isErrorTyped(right) ||
      (BINARY_ACCEPTED[op] !== undefined && (aggregate(left) || aggregate(right)))
    ) {
      return this.bindErrorOperands(node, left, right);
    }
    if (left.type.kind === "Unknown" || right.type.kind === "Unknown") {
      return this.invalid(node.span);
    }

    const arithmetic = ARITHMETIC[op];
    if (arithmetic !== undefined) {
      // Exponentiation is always floating point upstream; it has no Decimal overload.
      const kind = arithmetic === "Power" ? "Number" : this.numericKind(left.type, right.type);
      return this.binary(
        arithmetic,
        this.coerce(left, kind),
        this.coerce(right, kind),
        node,
        TARGET_TYPES[kind],
        kind,
      );
    }
    const ordering = ORDERING[op];
    if (ordering !== undefined) {
      // Mirrors upstream BinderUtils.CheckComparisonArgTypesCore: each operand is checked on its
      // own against Number/Decimal/Date/Time/DateTime/Dynamic, so Text and Boolean are rejected.
      const bad = [left, right].filter(
        (o) =>
          o.type.kind === "Boolean" ||
          o.type.kind === "Text" ||
          o.type.kind === "Record" ||
          o.type.kind === "Table",
      );
      for (const operand of bad) {
        this.report(DiagnosticCodes.InvalidArgumentType, operand.span, []);
      }
      if (bad.length > 0) return this.invalid(node.span);
      const kind = this.numericKind(left.type, right.type);
      return this.binary(
        ordering,
        this.coerce(left, kind),
        this.coerce(right, kind),
        node,
        BooleanType,
        kind,
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
        const aggregate = (k: string): boolean => k === "Record" || k === "Table";
        const scalar = (k: string): boolean =>
          k === "Number" || k === "Decimal" || k === "Text" || k === "Boolean";
        if ((aggregate(lk) && scalar(rk)) || (scalar(lk) && aggregate(rk))) {
          // A scalar never compares with an aggregate upstream (CheckEqualArgTypesCore).
          this.report(DiagnosticCodes.IncompatibleTypesForComparison, this.operatorSpan(node), [
            typeName(left.type),
            typeName(right.type),
          ]);
          return this.recovered(node.span, BooleanType);
        }
        if (lk === "Record" || rk === "Record" || lk === "Table" || rk === "Table") {
          // Upstream aggregate equality has its own rules, not yet traced or implemented.
          return this.notSupported("Record or table comparison", node.span);
        }
        const numeric = (k: string): boolean => k === "Number" || k === "Decimal";
        if (numeric(lk) && numeric(rk) && lk !== rk) {
          // Number and Decimal operands meet in the common numeric kind (as for arithmetic).
          const kind = this.numericKind(left.type, right.type);
          return this.binary(
            op,
            this.coerce(left, kind),
            this.coerce(right, kind),
            node,
            BooleanType,
          );
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

  /**
   * Diagnostics for a binary operator with an out-of-range literal operand. The other operand is
   * still checked, and the node keeps the operator's result type so the enclosing expression is
   * checked normally (verified against the reference).
   */
  private bindErrorOperands(node: BinaryNode, left: BoundNode, right: BoundNode): BoundNode {
    const op = node.op;
    const resultType: FormulaType =
      op === "Concat"
        ? TextType
        : op === "And" || op === "Or" || ORDERING[op] !== undefined || op === "Eq" || op === "Neq"
          ? BooleanType
          : NumberType;
    if (op === "Eq" || op === "Neq") {
      // Upstream CheckEqualArgTypesCore reports one comparison error at the operator.
      this.report(DiagnosticCodes.IncompatibleTypesForComparison, this.operatorSpan(node), [
        this.isErrorTyped(left) ? "Error" : typeName(left.type),
        this.isErrorTyped(right) ? "Error" : typeName(right.type),
      ]);
      return this.recovered(node.span, resultType);
    }
    const accepted = BINARY_ACCEPTED[op];
    if (accepted === undefined) return this.recovered(node.span, resultType);
    const operands: [BoundNode, string][] = [
      [left, accepted[0]],
      [right, accepted[1]],
    ];
    for (const [operand, list] of operands) {
      const bad =
        this.isErrorTyped(operand) ||
        operand.type.kind === "Record" ||
        operand.type.kind === "Table";
      if (!bad) continue;
      if (ORDERING[op] !== undefined) {
        this.report(DiagnosticCodes.InvalidArgumentType, operand.span, []);
      } else {
        this.reportErrorOperand(operand, list);
      }
    }
    return this.recovered(node.span, resultType);
  }

  private binary(
    op: BoundBinaryOperator,
    left: BoundNode,
    right: BoundNode,
    node: BinaryNode,
    type: FormulaType,
    numeric?: NumericKind,
  ): BoundNode {
    const bound = { kind: "Binary" as const, op, left, right, span: node.span, type };
    return numeric === undefined ? bound : { ...bound, numeric };
  }

  /**
   * Result type of an `If` whose results include records or tables (upstream
   * `TryDetermineReturnTypePowerFxV1CompatRules`: fold `TryUnionWithCoerce` left to right). Returns
   * the union type, `undefined` when no result is an aggregate, or a diagnostic node when the
   * results do not unify.
   */
  private ifAggregateUnion(
    args: readonly BoundNode[],
    node: CallNode,
  ): { readonly union: FormulaType } | { readonly error: BoundNode } | undefined {
    const results = args
      .filter((_, i) => i % 2 === 1 || (args.length % 2 === 1 && i === args.length - 1))
      .map((a) => a.type)
      .filter((t) => t.kind !== "Unknown");
    if (!results.some((t) => t.kind === "Record" || t.kind === "Table")) return undefined;
    let union: FormulaType | undefined = results[0];
    for (const type of results.slice(1)) {
      union = union === undefined ? undefined : unionTypes(union, type);
    }
    if (union === undefined) {
      this.report(DiagnosticCodes.ResultTypeMismatch, node.span);
      return { error: this.invalid(node.span) };
    }
    return { union };
  }

  private bindCall(node: CallNode): BoundNode {
    const name = node.callee.name;
    if (!this.functions.get(name)) {
      if (name === "With") return this.bindWith(node);
      if (name === "Filter") return this.bindFilter(node);
      if (name === "Table") return this.bindTableCall(node);
      if (name === "First") return this.bindFirst(node);
      if (name === "CountRows") return this.bindCountRows(node);
      if (name === "LookUp") return this.bindLookUp(node);
      if (name === "Decimal" || name === "Float" || name === "Value") {
        return this.bindNumericConversion(node, name);
      }
    }
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

    if (name === "Coalesce") return this.bindCoalesce(node, args);

    if (args.some((a) => a.type.kind === "Unknown")) {
      this.report(DiagnosticCodes.InvalidFunctionArguments, node.callee.span, [name]);
      return this.invalid(node.span);
    }

    let union: FormulaType | undefined;
    if (name === "If") {
      const result = this.ifAggregateUnion(args, node);
      if (result !== undefined && "error" in result) return result.error;
      union = result?.union;
    }
    const check = signature.check(args.map((a) => a.type));
    const isResult = (i: number): boolean =>
      i % 2 === 1 || (args.length % 2 === 1 && i === args.length - 1);
    return {
      kind: "Call",
      fn: name,
      args: args.map((a, i) =>
        union !== undefined && isResult(i)
          ? this.conformTo(a, union)
          : this.coerce(a, check.coercions[i], check.preserveBlank?.[i] ?? false),
      ),
      span: node.span,
      type: union ?? check.returnType,
    };
  }
}
