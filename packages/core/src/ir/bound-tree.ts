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
  /** Placeholder for an expression that failed to bind; never evaluated. */
  | (BoundBase & { readonly kind: "Invalid" });
