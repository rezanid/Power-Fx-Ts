import { Engine, type Diagnostic, type FormulaValue } from "@powerfx-ts/engine";
import type { CompatibilityProfile } from "./profile.js";
import type { ExpressionRunner, RunResult } from "./runner.js";

/**
 * Serializes a value in the compact form used by upstream expected results. Only the value kinds
 * the engine can produce are handled; anything else is a bug, so it throws rather than guessing.
 */
/** Field names that are not plain identifiers are single-quoted, as in the upstream expectations. */
const RESERVED_WORDS = new Set([
  "true",
  "false",
  "in",
  "exactin",
  "Self",
  "Parent",
  "And",
  "Or",
  "Not",
  "As",
  "blank",
  "null",
  "empty",
  "none",
  "nothing",
  "undefined",
  "Is",
  "This",
  "Child",
  "Children",
  "Siblings",
]);
const fieldName = (name: string): string =>
  /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !RESERVED_WORDS.has(name)
    ? name
    : `'${name.replaceAll("'", "''")}'`;

/** Upstream `RecordValue.ToExpression` prints fields sorted by ordinal name. */
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function serializeValue(value: FormulaValue, engine: Engine): string {
  switch (value.kind) {
    case "Blank":
      return "Blank()";
    case "Boolean":
      return value.value ? "true" : "false";
    case "Text":
      return `"${value.value.replaceAll('"', '""')}"`;
    case "Number":
      return engine.formatNumber(value.value);
    case "Decimal":
      return engine.formatDecimal(value.value);
    case "Record":
      return `{${[...value.fields]
        .sort(byName)
        .map((f) => `${fieldName(f.name)}:${serializeValue(f.value, engine)}`)
        .join(",")}}`;
    case "Table":
      return `Table(${value.rows.map((r) => serializeValue(r, engine)).join(",")})`;
    case "Error": {
      // Mirrors upstream ErrorValue.ToExpression (compact form): several errors become a Table.
      const kinds = value.errors.map((x) => `{Kind:ErrorKind.${x.kind}}`);
      if (kinds.length === 0) return "Error({Kind:ErrorKind.Unknown})";
      return kinds.length > 1 ? `Error(Table(${kinds.join(",")}))` : `Error(${kinds[0]})`;
    }
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const label = d.severity === "warning" ? "Warning" : "Error";
  return `${label} ${d.span.start}-${d.span.end}: ${d.message}`;
}

/**
 * Adapter that runs upstream cases through the real TypeScript engine. Anything the engine slice
 * does not implement (unknown functions, records, tables, ...) is `unsupported`, never a pass.
 */
export function createEngineRunner(override?: Engine): ExpressionRunner {
  const engines = new Map<string, Engine>();
  const engineFor = (mode: "float" | "decimal"): Engine => {
    if (override !== undefined && override.numberMode === mode) return override;
    let engine = engines.get(mode);
    if (engine === undefined) {
      engine = new Engine({ numberMode: mode });
      engines.set(mode, engine);
    }
    return engine;
  };
  return {
    supportedHandlers: new Set(),
    async run(input: string, profile: CompatibilityProfile): Promise<RunResult> {
      const engine = engineFor(profile.numberMode);
      const result = await engine.evaluate(input);
      switch (result.kind) {
        case "value":
          return result.value.kind === "Decimal"
            ? { kind: "value", text: serializeValue(result.value, engine), numeric: "decimal" }
            : { kind: "value", text: serializeValue(result.value, engine) };
        case "invalid":
          return {
            kind: "errors",
            errors: result.diagnostics
              .filter((d) => d.severity === "error" || d.severity === "warning")
              .map(formatDiagnostic),
          };
        case "unsupported":
          return {
            kind: "unsupported",
            category: "feature",
            reason: result.features.map((f) => f.feature).join(", "),
          };
      }
    },
  };
}
