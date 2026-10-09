import type { FormulaType, RecordTypeOf } from "./formula-type.js";
import { typesEqual } from "./formula-type.js";

/** Scalar kinds that coerce to each other when a type union needs it. */
type ScalarKind = "Number" | "Decimal" | "Text" | "Boolean";

const isScalar = (t: FormulaType): t is Extract<FormulaType, { kind: ScalarKind }> =>
  t.kind === "Number" || t.kind === "Decimal" || t.kind === "Text" || t.kind === "Boolean";

/**
 * How a value of one type is rebuilt as another (the union result). Produced next to the union so
 * binding and evaluation share one definition; evaluation never infers types from values.
 */
export type ConformPlan =
  | { readonly kind: "Scalar"; readonly to: ScalarKind }
  | {
      readonly kind: "Record";
      /** Target field order. `plan` is absent for an unchanged field, `missing` for a Blank fill. */
      readonly fields: readonly {
        readonly name: string;
        readonly plan?: ConformPlan;
        readonly missing?: true;
      }[];
    }
  | { readonly kind: "Table"; readonly row: Extract<ConformPlan, { kind: "Record" }> };

/**
 * Upstream `DType.TryUnionWithCoerce(coerceToLeftTypeOnly: true)` for the supported subset (the
 * pinned `If` and table-construction rule under PowerFxV1CompatibilityRules). The left type wins:
 *
 * - identical types stay; a Blank type (ObjNull) takes the other side;
 * - Number (float), Decimal, Text and Boolean coerce right-to-left when they differ;
 * - records union field by field (missing fields are added, shared fields union recursively; the
 *   result is ordinal-sorted); tables union their row types;
 * - a record or table never unions with a scalar, and a record never with a table.
 *
 * Returns `undefined` when the types are incompatible.
 */
export function unionTypes(left: FormulaType, right: FormulaType): FormulaType | undefined {
  if (left.kind === "Unknown" || right.kind === "Unknown") return undefined;
  if (typesEqual(left, right)) return left;
  if (left.kind === "Blank") return right;
  if (right.kind === "Blank") return left;
  if (left.kind === "Record" && right.kind === "Record") return unionRecords(left, right);
  if (left.kind === "Table" && right.kind === "Table") {
    const row = unionRecords(left.row, right.row);
    return row === undefined ? undefined : { kind: "Table", row };
  }
  if (isScalar(left) && isScalar(right)) return left;
  return undefined;
}

export function unionRecords(a: RecordTypeOf, b: RecordTypeOf): RecordTypeOf | undefined {
  const byName = new Map(a.fields.map((f) => [f.name, f]));
  for (const f of b.fields) {
    const existing = byName.get(f.name);
    if (existing === undefined) {
      byName.set(f.name, f);
      continue;
    }
    const type = unionTypes(existing.type, f.type);
    if (type === undefined) return undefined;
    byName.set(f.name, { name: f.name, type });
  }
  const fields = [...byName.values()].sort((x, y) =>
    x.name < y.name ? -1 : x.name > y.name ? 1 : 0,
  );
  return { kind: "Record", fields };
}

/**
 * The plan that rebuilds a `from` value as `to`, which must be a union result of `from` (as
 * produced by `unionTypes`). `undefined` means no change is needed.
 */
export function conformPlan(from: FormulaType, to: FormulaType): ConformPlan | undefined {
  if (typesEqual(from, to)) return undefined;
  if (isScalar(from) && isScalar(to)) return { kind: "Scalar", to: to.kind };
  if (from.kind === "Record" && to.kind === "Record") return recordPlan(from, to);
  if (from.kind === "Table" && to.kind === "Table") {
    const row = recordPlan(from.row, to.row);
    return row === undefined ? undefined : { kind: "Table", row };
  }
  return undefined;
}

function recordPlan(
  from: RecordTypeOf,
  to: RecordTypeOf,
): Extract<ConformPlan, { kind: "Record" }> | undefined {
  const source = new Map(from.fields.map((f) => [f.name, f.type]));
  const fields = to.fields.map((f) => {
    const type = source.get(f.name);
    if (type === undefined) return { name: f.name, missing: true as const };
    const plan = conformPlan(type, f.type);
    return plan === undefined ? { name: f.name } : { name: f.name, plan };
  });
  const unchanged =
    fields.length === from.fields.length &&
    fields.every((f, i) => f.name === from.fields[i]!.name && !("plan" in f) && !("missing" in f));
  return unchanged ? undefined : { kind: "Record", fields };
}
