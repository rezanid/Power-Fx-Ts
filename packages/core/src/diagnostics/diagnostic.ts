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
  BadToken: "PFX1012",
  ColonExpected: "PFX1013",
  NameNotRecognized: "PFX2001",
  IncompatibleTypesForComparison: "PFX2002",
  InvalidFunctionArguments: "PFX2003",
  BadArity: "PFX2004",
  BadArityMinimum: "PFX2005",
  InvalidArgumentType: "PFX2006",
  UnknownFunction: "PFX2007",
  BadTypeExpected: "PFX2008",
  InvalidDot: "PFX2009",
  DuplicateField: "PFX2010",
  ResultTypeMismatch: "PFX2011",
  AsNotInContext: "PFX2012",
  NeedTable: "PFX2013",
  BooleanExpected: "PFX2014",
  NeedRecordOrTable: "PFX2015",
  TableDoesNotAcceptThisType: "PFX2016",
  BadType: "PFX2017",
  FilterOnlyTwoArgs: "PFX2018",
  DeprecatedDotUseShowColumns: "PFX2019",
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
  // Parser messages reuse upstream's English wording; {0}/{1} are upstream TokKind names.
  PFX1001:
    "Expected an operand. The formula or expression expects a valid operand. For example, you can add the operand '2' to the expression ' 1 +_' so that the result is '3'. Or, you can add the operand \"there\" to the expression '\"Hi \"& _ ' so that the result is 'Hi there'.",
  PFX1002:
    "Expected operator. We expect an operator such as +, *, or & at this point in the formula.",
  PFX1003: "Unexpected characters. The formula contains '{0}' where '{1}' is expected.",
  PFX1004: "Unexpected characters. The formula contains '{0}' where it isn't expected.",
  PFX1005: "Unterminated text literal.",
  PFX1006: "Unterminated quoted identifier.",
  PFX1007: "Unterminated comment.",
  PFX1008: "Numeric value is too large.",
  PFX1009: "Invalid number.",
  PFX1010: "The expression is nested too deeply.",
  PFX1011: "Use of a reserved word that is currently not supported.",
  PFX1012: "Unexpected characters. Characters are used in the formula in an unexpected way.",
  PFX1013: "Expected colon. We expect a colon (:) at this point in the formula.",
  // Binder messages reuse upstream's English wording so compile-error expectations can match.
  PFX2001: "Name isn't valid. '{0}' isn't recognized.",
  PFX2002: "Incompatible types for comparison. These types can't be compared: {0}, {1}.",
  PFX2003: "The function '{0}' has some invalid arguments.",
  PFX2004: "Invalid number of arguments: received {0}, expected {1}.",
  PFX2005: "Invalid number of arguments: received {0}, expected {1} or more.",
  PFX2007: "'{0}' is an unknown or unsupported function.",
  PFX2008: "Invalid argument type ({1}). Expecting a {0} value instead.",
  PFX2009: "The '.' operator cannot be used on {0} values.",
  PFX2010: "A field named '{0}' was specified more than once in this record.",
  PFX2011:
    "Argument type mismatch. The types of all result arguments must agree with or be coercible to the first result argument.",
  PFX2012: "As is not permitted in this context",
  PFX2013: "The first argument of '{0}' should be a table.",
  PFX2014: "Expected boolean. We expect a boolean (true/false) at this point in the formula.",
  PFX2015: "Only record or table values can be used in this context.",
  PFX2016:
    "Incompatible type. The item you are trying to put into a table has a type that is not compatible with the table.",
  PFX2017: "Invalid argument type.",
  PFX2019: "Deprecated use of '.'. Please use the 'ShowColumns' function instead.",
  PFX2018: "Use the And operator to combine multiple predicates into the second argument.",
  PFX2006:
    "Invalid argument type. Expecting one of the following: Number, Decimal, Date, Time, DateTime, Dynamic.",
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
