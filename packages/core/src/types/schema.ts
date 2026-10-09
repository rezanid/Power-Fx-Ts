import type { FormulaType } from "./formula-type.js";

export interface SchemaVariable {
  readonly name: string;
  readonly type: FormulaType;
}

/**
 * Explicit description of the names a formula may use. It holds types only, never runtime values,
 * so a formula can be checked once and evaluated against many value sets. Plain data, so it can
 * be serialized and sent to a worker.
 */
export interface Schema {
  /** Optional host-assigned version; checked results record it for staleness detection. */
  readonly version?: string | number;
  readonly variables: readonly SchemaVariable[];
}

export function defineSchema(
  variables: Readonly<Record<string, FormulaType>>,
  version?: string | number,
): Schema {
  const list = Object.entries(variables).map(([name, type]) => ({ name, type }));
  return version === undefined ? { variables: list } : { version, variables: list };
}

export function findVariable(schema: Schema, name: string): SchemaVariable | undefined {
  return schema.variables.find((v) => v.name === name);
}
