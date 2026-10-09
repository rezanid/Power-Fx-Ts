import type { Span } from "../text/span.js";

export type TokenKind =
  | "Ident"
  | "Number"
  | "String"
  | "True"
  | "False"
  | "In"
  | "Exactin"
  | "Whitespace"
  | "Comment"
  | "Plus"
  | "Minus"
  | "Star"
  | "Slash"
  | "Caret"
  | "Percent"
  | "Amp"
  | "AmpAmp"
  | "PipePipe"
  | "Bang"
  | "Eq"
  | "Lt"
  | "LtEq"
  | "Gt"
  | "GtEq"
  | "LtGt"
  | "Comma"
  | "Dot"
  | "Colon"
  | "Semicolon"
  | "ParenOpen"
  | "ParenClose"
  | "BraceOpen"
  | "BraceClose"
  | "BracketOpen"
  | "BracketClose"
  | "Error"
  | "Eof";

export interface Token {
  readonly kind: TokenKind;
  readonly span: Span;
  /** Raw source text of the token. */
  readonly text: string;
  /** For Ident (quoted or not) and String tokens: the unescaped value. */
  readonly value?: string;
}

export function isTrivia(kind: TokenKind): boolean {
  return kind === "Whitespace" || kind === "Comment";
}
