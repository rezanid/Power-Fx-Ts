import type { NumericValue } from "../numeric/backend.js";

/** Upstream `ErrorKind` member names that this slice can produce. */
export type ErrorKind = "Div0" | "InvalidArgument" | "Numeric";

export interface NumberValue {
  readonly kind: "Number";
  readonly value: NumericValue;
}
export interface TextValue {
  readonly kind: "Text";
  readonly value: string;
}
export interface BooleanValue {
  readonly kind: "Boolean";
  readonly value: boolean;
}
export interface BlankValue {
  readonly kind: "Blank";
}

export interface FormulaError {
  readonly kind: ErrorKind;
  readonly message: string;
}

/** Runtime errors are values: they propagate through operators instead of being thrown. */
export interface ErrorValue {
  readonly kind: "Error";
  readonly errors: readonly FormulaError[];
}

export interface RecordFieldValue {
  readonly name: string;
  readonly value: FormulaValue;
}
export interface RecordValue {
  readonly kind: "Record";
  readonly fields: readonly RecordFieldValue[];
}

export type FormulaValue =
  NumberValue | TextValue | BooleanValue | BlankValue | ErrorValue | RecordValue;

export const blank: BlankValue = Object.freeze({ kind: "Blank" });
export const number = (value: NumericValue): NumberValue => ({ kind: "Number", value });
export const text = (value: string): TextValue => ({ kind: "Text", value });
export const boolean = (value: boolean): BooleanValue => ({ kind: "Boolean", value });

const MESSAGES: Readonly<Record<ErrorKind, string>> = {
  Div0: "Division by zero",
  InvalidArgument: "Invalid argument",
  Numeric: "Numeric value is out of range",
};

export const error = (kind: ErrorKind, message: string = MESSAGES[kind]): ErrorValue => ({
  kind: "Error",
  errors: [{ kind, message }],
});
