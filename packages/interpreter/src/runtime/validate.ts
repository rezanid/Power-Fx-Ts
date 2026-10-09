import { snapshotSchema, type FormulaType, type Schema } from "@powerfx-ts/core";
import { numericBackendId, type NumericBackend } from "../numeric/backend.js";
import { blank, boolean, number, text, type FormulaValue } from "../values/values.js";

export type ValueIssueCode =
  "MissingVariable" | "UnexpectedVariable" | "UnexpectedField" | "InvalidType";

/** A host-input problem. `path` is e.g. `Customer.RiskScore`. These are not formula diagnostics. */
export interface ValueIssue {
  readonly code: ValueIssueCode;
  readonly path: string;
  readonly message: string;
}

declare const validatedBrand: unique symbol;

/**
 * Runtime values proven to conform to `schema`. Only `validateValues` can create one, so the
 * evaluator never sees a value that disagrees with the types the formula was checked against.
 */
export interface ValidatedValues {
  readonly [validatedBrand]: true;
  readonly schema: Schema;
  /** Numbers are backend-specific, so values only work with the backend instance that made them. */
  readonly numericId: number;
  readonly values: ReadonlyMap<string, FormulaValue>;
}

export type ValidationResult =
  | { readonly ok: true; readonly values: ValidatedValues }
  | { readonly ok: false; readonly issues: readonly ValueIssue[] };

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Converts plain JS input to runtime values, strictly and without coercion.
 * - `null`/`undefined` is Blank for any type (also a missing record field).
 * - A variable missing from the input is an error; so are unknown variables/fields.
 * - Number needs a finite JS number, Text a string, Boolean a boolean, Record a plain object.
 */
export function validateValues(
  schema: Schema,
  input: unknown,
  numeric: NumericBackend,
): ValidationResult {
  schema = snapshotSchema(schema);
  const issues: ValueIssue[] = [];
  const values = new Map<string, FormulaValue>();
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [{ code: "InvalidType", path: "", message: "Values must be a plain object." }],
    };
  }
  for (const variable of schema.variables) {
    if (!own(input, variable.name)) {
      issues.push({
        code: "MissingVariable",
        path: variable.name,
        message: `No value was supplied for '${variable.name}'.`,
      });
      continue;
    }
    values.set(variable.name, convert(variable.type, input[variable.name], variable.name));
  }
  for (const key of Object.keys(input)) {
    if (!schema.variables.some((v) => v.name === key)) {
      issues.push({
        code: "UnexpectedVariable",
        path: key,
        message: `'${key}' is not declared in the schema.`,
      });
    }
  }
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        values: {
          schema,
          numericId: numericBackendId(numeric),
          values,
        } as unknown as ValidatedValues,
      };

  function convert(type: FormulaType, raw: unknown, path: string): FormulaValue {
    if (raw === null || raw === undefined) return blank;
    const bad = (expected: string): FormulaValue => {
      issues.push({
        code: "InvalidType",
        path,
        message: `Expected ${expected} at '${path}' but received ${describe(raw)}.`,
      });
      return blank;
    };
    switch (type.kind) {
      case "Number": {
        if (typeof raw !== "number") return bad("a number");
        const n = numeric.fromNumber(raw);
        return n === undefined ? bad("a finite number") : number(n);
      }
      case "Text":
        return typeof raw === "string" ? text(raw) : bad("text");
      case "Boolean":
        return typeof raw === "boolean" ? boolean(raw) : bad("a boolean");
      case "Record": {
        if (!isPlainObject(raw)) return bad("a record (plain object)");
        for (const key of Object.keys(raw)) {
          if (!type.fields.some((f) => f.name === key)) {
            issues.push({
              code: "UnexpectedField",
              path: `${path}.${key}`,
              message: `'${key}' is not a field of '${path}'.`,
            });
          }
        }
        return {
          kind: "Record",
          fields: type.fields.map((f) => ({
            name: f.name,
            value: own(raw, f.name) ? convert(f.type, raw[f.name], `${path}.${f.name}`) : blank,
          })),
        };
      }
      case "Blank":
      case "Unknown":
        return bad("no value (Blank)");
    }
  }
}

function describe(v: unknown): string {
  if (typeof v === "number") return `number ${String(v)}`;
  if (Array.isArray(v)) return "an array";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}
