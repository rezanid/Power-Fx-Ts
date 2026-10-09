/**
 * Static types of the first vertical slice. Records, tables, dates and the Decimal/Float split
 * (ADR 0002, Phase 2) are intentionally absent; the union is closed so adding them forces every
 * `switch` over types to be revisited.
 */
export type FormulaType =
  | { readonly kind: "Number" }
  | { readonly kind: "Text" }
  | { readonly kind: "Boolean" }
  /** Type of the `Blank()` literal; compatible with every other type. */
  | { readonly kind: "Blank" }
  /** Result of an expression that failed to bind; suppresses cascading diagnostics. */
  | { readonly kind: "Unknown" };

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
