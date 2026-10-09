import type { Token } from "../lexer/tokens.js";
import type { Span } from "../text/span.js";

export type BinaryOperator =
  | "Or"
  | "And"
  | "In"
  | "Exactin"
  | "Eq"
  | "Neq"
  | "Lt"
  | "LtEq"
  | "Gt"
  | "GtEq"
  | "Concat"
  | "Add"
  | "Sub"
  | "Mul"
  | "Div"
  | "Power";

export type UnaryOperator = "Negate" | "Not" | "Percent";

interface NodeBase {
  readonly span: Span;
}

export interface NumberLiteralNode extends NodeBase {
  readonly kind: "NumberLiteral";
  /** Raw source text; the numeric backend decides representation. */
  readonly text: string;
}

export interface StringLiteralNode extends NodeBase {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface BooleanLiteralNode extends NodeBase {
  readonly kind: "BooleanLiteral";
  readonly value: boolean;
}

export interface NameNode extends NodeBase {
  readonly kind: "Name";
  readonly name: string;
  readonly quoted: boolean;
}

export interface DottedNameNode extends NodeBase {
  readonly kind: "DottedName";
  readonly left: ExpressionNode;
  readonly right: NameNode | MissingNode;
  /** The `.` token; upstream reports member-access errors from the dot to the end of the name. */
  readonly dot: Span;
}

export interface CallNode extends NodeBase {
  readonly kind: "Call";
  readonly callee: NameNode;
  readonly args: readonly ExpressionNode[];
  /** False when the closing parenthesis is missing. */
  readonly closed: boolean;
}

export interface UnaryNode extends NodeBase {
  readonly kind: "Unary";
  readonly op: UnaryOperator;
  readonly operand: ExpressionNode;
}

export interface BinaryNode extends NodeBase {
  readonly kind: "Binary";
  readonly op: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface GroupNode extends NodeBase {
  readonly kind: "Group";
  readonly expression: ExpressionNode;
  readonly closed: boolean;
}

export interface RecordFieldNode extends NodeBase {
  readonly kind: "RecordField";
  readonly name: NameNode | MissingNode;
  readonly value: ExpressionNode;
}

export interface RecordNode extends NodeBase {
  readonly kind: "Record";
  readonly fields: readonly RecordFieldNode[];
  readonly closed: boolean;
}

export interface TableNode extends NodeBase {
  readonly kind: "Table";
  readonly items: readonly ExpressionNode[];
  readonly closed: boolean;
}

export interface ChainNode extends NodeBase {
  readonly kind: "Chain";
  readonly items: readonly ExpressionNode[];
}

/** Zero-width placeholder where a required node was absent. */
export interface MissingNode extends NodeBase {
  readonly kind: "Missing";
}

/** Source the parser could not interpret; keeps the offending tokens. */
export interface ErrorNode extends NodeBase {
  readonly kind: "Error";
  readonly tokens: readonly Token[];
  /** Operands parsed around a misplaced token, kept so tooling can still see them. */
  readonly operands?: readonly ExpressionNode[];
}

export type ExpressionNode =
  | NumberLiteralNode
  | StringLiteralNode
  | BooleanLiteralNode
  | NameNode
  | DottedNameNode
  | CallNode
  | UnaryNode
  | BinaryNode
  | GroupNode
  | RecordNode
  | TableNode
  | ChainNode
  | MissingNode
  | ErrorNode;

export type SyntaxNode = ExpressionNode | RecordFieldNode;
