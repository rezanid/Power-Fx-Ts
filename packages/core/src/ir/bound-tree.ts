import type { Span } from "../text/span.js";
import type { FormulaType } from "../types/formula-type.js";

/** Scalar types an operand can be implicitly converted to. */
export type CoercionTarget = "Number" | "Text" | "Boolean";

export type BoundUnaryOperator = "Negate" | "Not" | "Percent";
export type BoundBinaryOperator =
  | "Add"
  | "Sub"
  | "Mul"
  | "Div"
  | "Power"
  | "Concat"
  | "And"
  | "Or"
  | "Eq"
  | "Neq"
  | "Lt"
  | "LtEq"
  | "Gt"
  | "GtEq";

interface BoundBase {
  readonly span: Span;
  readonly type: FormulaType;
}

/**
 * Typed, coercion-explicit tree produced by the binder and consumed by the evaluator.
 * Operand coercions are materialised as `Coerce` nodes so evaluation never re-derives typing rules.
 */
export type BoundNode =
  | (BoundBase & { readonly kind: "NumberLiteral"; readonly text: string })
  | (BoundBase & { readonly kind: "TextLiteral"; readonly value: string })
  | (BoundBase & { readonly kind: "BooleanLiteral"; readonly value: boolean })
  | (BoundBase & {
      readonly kind: "Unary";
      readonly op: BoundUnaryOperator;
      readonly operand: BoundNode;
    })
  | (BoundBase & {
      readonly kind: "Binary";
      readonly op: BoundBinaryOperator;
      readonly left: BoundNode;
      readonly right: BoundNode;
    })
  | (BoundBase & {
      readonly kind: "Coerce";
      readonly to: CoercionTarget;
      readonly operand: BoundNode;
      /** Blank operands stay Blank instead of becoming the target's zero value. */
      readonly preserveBlank?: boolean;
    })
  | (BoundBase & {
      readonly kind: "Call";
      readonly fn: string;
      readonly args: readonly BoundNode[];
    })
  /** Reference to a schema variable; the evaluator reads it from the supplied runtime values. */
  | (BoundBase & { readonly kind: "Variable"; readonly name: string })
  | (BoundBase & {
      readonly kind: "FieldAccess";
      readonly record: BoundNode;
      readonly field: string;
    })
  /** Record literal; fields are evaluated in order and errors are stored in the field. */
  | (BoundBase & {
      readonly kind: "Record";
      readonly fields: readonly { readonly name: string; readonly value: BoundNode }[];
    })
  /**
   * `With(scope, body)`: evaluates `scope`, then `body` with that record's fields bound as
   * `Local`s of `scopeId`. A Blank scope gives Blank without evaluating `body`.
   */
  | (BoundBase & {
      readonly kind: "With";
      readonly scopeId: number;
      readonly scope: BoundNode;
      readonly body: BoundNode;
    })
  /** Field of the enclosing `With` scope identified by `scopeId` (unique per `With` node). */
  | (BoundBase & { readonly kind: "Local"; readonly scopeId: number; readonly name: string })
  /** The whole row-scope value (`ThisRecord` or an `As` alias) of the scope `scopeId`. */
  | (BoundBase & { readonly kind: "ScopeRecord"; readonly scopeId: number })
  /**
   * Table construction (literal or `Table(...)`). `row` items contribute one row (a record, or an
   * untyped Blank that becomes a Blank row); `rows` items are tables whose rows are spliced in.
   * Rows are conformed to the table's row type, filling missing fields with Blank.
   */
  | (BoundBase & {
      readonly kind: "Table";
      readonly items: readonly { readonly shape: "row" | "rows"; readonly value: BoundNode }[];
    })
  /**
   * `Filter(source, predicate)`: evaluates `predicate` once per row with that row bound as the
   * scope `scopeId`. A Blank source gives Blank; an Error predicate yields an error row.
   */
  | (BoundBase & {
      readonly kind: "Filter";
      readonly scopeId: number;
      readonly source: BoundNode;
      readonly predicate: BoundNode;
    })
  /** `First(source)`: the first row, Blank for an empty or Blank table; an error row is returned. */
  | (BoundBase & { readonly kind: "First"; readonly source: BoundNode })
  /** `CountRows(source)`: Blank source gives 0; the first error row is returned. */
  | (BoundBase & { readonly kind: "CountRows"; readonly source: BoundNode })
  /**
   * `LookUp(source, predicate[, projection])`: evaluates `predicate` for every row in the scope
   * `scopeId` (upstream does not short-circuit), then yields the first row, or `projection`
   * evaluated in that row's scope. No row gives Blank.
   */
  | (BoundBase & {
      readonly kind: "LookUp";
      readonly scopeId: number;
      readonly source: BoundNode;
      readonly predicate: BoundNode;
      readonly projection: BoundNode | undefined;
    })
  /** Placeholder for an expression that failed to bind; never evaluated. */
  | (BoundBase & { readonly kind: "Invalid" });
