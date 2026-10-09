import type { Span } from "../text/span.js";

export type TokenKind =
  | "Ident"
  | "Number"
  | "String"
  | "True"
  | "False"
  | "In"
  | "Exactin"
  | "As"
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

const UPSTREAM_KIND_NAMES: Partial<Record<TokenKind, string>> = {
  Number: "NumLit",
  String: "StrLit",
  Plus: "Add",
  Minus: "Sub",
  Star: "Mul",
  Slash: "Div",
  Amp: "Ampersand",
  Percent: "PercentSign",
  AmpAmp: "And",
  PipePipe: "Or",
  Eq: "Equ",
  Lt: "Lss",
  LtEq: "LssEqu",
  Gt: "Grt",
  GtEq: "GrtEqu",
  LtGt: "LssGrt",
  BraceOpen: "CurlyOpen",
  BraceClose: "CurlyClose",
};

/** The upstream `TokKind` name, which appears verbatim in upstream diagnostics. */
export function upstreamKindName(kind: TokenKind): string {
  return UPSTREAM_KIND_NAMES[kind] ?? kind;
}

export function isTrivia(kind: TokenKind): boolean {
  return kind === "Whitespace" || kind === "Comment";
}
