import type { Span } from "../text/span.js";

export type Severity = "error" | "warning" | "info" | "hint";

/** Stable diagnostic codes. Never renumber or reuse a code. */
export const DiagnosticCodes = {
  OperandExpected: "PFX1001",
  OperatorExpected: "PFX1002",
  ExpectedToken: "PFX1003",
  UnexpectedCharacters: "PFX1004",
  UnterminatedString: "PFX1005",
  UnterminatedIdentifier: "PFX1006",
  UnterminatedComment: "PFX1007",
  NumberTooLarge: "PFX1008",
  InvalidNumber: "PFX1009",
  NestedTooDeeply: "PFX1010",
  ReservedWord: "PFX1011",
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly span: Span;
  readonly args: readonly string[];
  readonly message: string;
}

const TEMPLATES: Record<DiagnosticCode, string> = {
  PFX1001: "Expected an operand. We expect an expression at this point in the formula.",
  PFX1002:
    "Expected an operator. We expect an operator such as +, *, or & at this point in the formula.",
  PFX1003: "Expected {0}. We expect {0} at this point in the formula.",
  PFX1004: "Unexpected characters. The formula contains '{0}' where it isn't expected.",
  PFX1005: "Unterminated text literal.",
  PFX1006: "Unterminated quoted identifier.",
  PFX1007: "Unterminated comment.",
  PFX1008: "Numeric value is too large.",
  PFX1009: "Invalid number.",
  PFX1010: "The expression is nested too deeply.",
  PFX1011: "Use of a reserved word that is currently not supported.",
};

export function formatMessage(code: DiagnosticCode, args: readonly string[]): string {
  return TEMPLATES[code].replace(/\{(\d+)\}/g, (_, i: string) => args[Number(i)] ?? "");
}

export function createDiagnostic(
  code: DiagnosticCode,
  span: Span,
  args: readonly string[] = [],
  severity: Severity = "error",
): Diagnostic {
  return { code, severity, span, args, message: formatMessage(code, args) };
}
