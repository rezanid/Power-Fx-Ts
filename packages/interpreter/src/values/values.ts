import type { NumericValue } from "../numeric/backend.js";

/** Upstream `ErrorKind` member names that this slice can produce. */
export type ErrorKind = "Div0" | "InvalidArgument" | "Numeric";

export interface NumberValue {
  readonly kind: "Number";
  readonly value: NumericValue;
}
/** Exact decimal value (upstream `DecimalValue`); `NumberValue` is the float variety. */
export interface DecimalValue {
  readonly kind: "Decimal";
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

/** A table row is a record, a Blank row, or an error row (e.g. from a failed `Filter` predicate). */
export type TableRow = RecordValue | BlankValue | ErrorValue;
export interface TableValue {
  readonly kind: "Table";
  readonly rows: readonly TableRow[];
}

export type FormulaValue =
  | NumberValue
  | DecimalValue
  | TextValue
  | BooleanValue
  | BlankValue
  | ErrorValue
  | RecordValue
  | TableValue;

/**
 * Every value (and nested record, field, error array and error object) is frozen on creation so no
 * evaluation result exposes mutable state. A custom numeric representation inside a Number value
 * is opaque and is not frozen; a backend with a mutable representation must freeze it itself.
 */
export function deepFreeze<T extends FormulaValue>(value: T): T {
  if (Object.isFrozen(value)) return value;
  if (value.kind === "Record") {
    for (const f of value.fields) {
      deepFreeze(f.value);
      Object.freeze(f);
    }
    Object.freeze(value.fields);
  } else if (value.kind === "Table") {
    for (const r of value.rows) deepFreeze(r);
    Object.freeze(value.rows);
  } else if (value.kind === "Error") {
    for (const e of value.errors) Object.freeze(e);
    Object.freeze(value.errors);
  }
  return Object.freeze(value);
}

export const record = (fields: readonly RecordFieldValue[]): RecordValue =>
  deepFreeze({ kind: "Record", fields: fields.map((f) => ({ name: f.name, value: f.value })) });

export const table = (rows: readonly TableRow[]): TableValue =>
  deepFreeze({ kind: "Table", rows: [...rows] });

export const blank: BlankValue = Object.freeze({ kind: "Blank" });
export const number = (value: NumericValue): NumberValue =>
  Object.freeze({ kind: "Number", value });
export const decimal = (value: NumericValue): DecimalValue =>
  Object.freeze({ kind: "Decimal", value });
export const text = (value: string): TextValue => Object.freeze({ kind: "Text", value });
export const boolean = (value: boolean): BooleanValue => Object.freeze({ kind: "Boolean", value });

const MESSAGES: Readonly<Record<ErrorKind, string>> = {
  Div0: "Division by zero",
  InvalidArgument: "Invalid argument",
  Numeric: "Numeric value is out of range",
};

export const error = (kind: ErrorKind, message: string = MESSAGES[kind]): ErrorValue =>
  deepFreeze({ kind: "Error", errors: [{ kind, message }] });
