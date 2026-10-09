/**
 * Static types. Dates and the Decimal/Float split (ADR 0002, Phase 2) are intentionally
 * absent; the union is closed so adding them forces every `switch` over types to be revisited.
 * Types are plain JSON-serializable data so they can cross a worker boundary.
 */
export type FormulaType =
  | { readonly kind: "Number" }
  | { readonly kind: "Text" }
  | { readonly kind: "Boolean" }
  /** Type of the `Blank()` literal; compatible with every other type. */
  | { readonly kind: "Blank" }
  /** Record with named, typed fields. Field names are case-sensitive; order is declaration order. */
  | { readonly kind: "Record"; readonly fields: readonly RecordField[] }
  /** Table whose rows all have the given record type (ADR 0006). */
  | { readonly kind: "Table"; readonly row: RecordTypeOf }
  /** Result of an expression that failed to bind; suppresses cascading diagnostics. */
  | { readonly kind: "Unknown" };

export type RecordTypeOf = Extract<FormulaType, { kind: "Record" }>;

export interface RecordField {
  readonly name: string;
  readonly type: FormulaType;
}

export type FormulaTypeKind = FormulaType["kind"];

export const NumberType: FormulaType = { kind: "Number" };
export const TextType: FormulaType = { kind: "Text" };
export const BooleanType: FormulaType = { kind: "Boolean" };
export const BlankType: FormulaType = { kind: "Blank" };
export const UnknownType: FormulaType = { kind: "Unknown" };

/** Name as shown in diagnostics (matches upstream display names). */
export function typeName(type: FormulaType): string {
  return type.kind === "Unknown" ? "Unknown" : type.kind;
}

/** Builds a record type from `{ name: type }` pairs, keeping insertion order. */
export function recordType(fields: Readonly<Record<string, FormulaType>>): FormulaType {
  return { kind: "Record", fields: Object.entries(fields).map(([name, type]) => ({ name, type })) };
}

/** Builds a table type from the types of its row fields. */
export function tableType(fields: readonly RecordField[]): FormulaType {
  return { kind: "Table", row: { kind: "Record", fields } };
}

/** Structural type equality; record and table field order is significant (types are normalized). */
export function typesEqual(a: FormulaType, b: FormulaType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "Record" && b.kind === "Record") {
    return (
      a.fields.length === b.fields.length &&
      a.fields.every(
        (f, i) => f.name === b.fields[i]!.name && typesEqual(f.type, b.fields[i]!.type),
      )
    );
  }
  if (a.kind === "Table" && b.kind === "Table") return typesEqual(a.row, b.row);
  return true;
}

/** Looks up a field by exact (case-sensitive) name. */
export function findField(
  type: Extract<FormulaType, { kind: "Record" }>,
  name: string,
): RecordField | undefined {
  return type.fields.find((f) => f.name === name);
}
