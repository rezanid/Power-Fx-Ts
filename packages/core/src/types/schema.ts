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

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Deep, frozen copy. Checked results and validated values keep a snapshot, so later mutation of
 * the host's schema object cannot change what an existing result means.
 */
export function snapshotSchema(schema: Schema): Schema {
  return deepFreeze(JSON.parse(JSON.stringify(schema)) as Schema);
}

/** Structural equality of two schemas (field order is significant, as in declaration order). */
export function schemasEqual(a: Schema, b: Schema): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
