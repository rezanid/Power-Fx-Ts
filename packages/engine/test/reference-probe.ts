import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { FormulaValue } from "@powerfx-ts/interpreter";
import type { FormulaType } from "@powerfx-ts/core";
import type { Engine } from "../src/index.js";

// Shared helpers for replaying rows of `tools/reference-harness probe` output. Each row is
// `expression<TAB>static type<TAB>result`; a result starting with `ERRORS:` lists compile errors
// (`Error start-end: message`, `|`-separated) instead of a value.

export function loadRows(fixture: string): { expr: string; type: string; result: string }[] {
  const text = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [expr = "", type = "", result = ""] = line.split("\t");
      return { expr, type, result };
    });
}

/** Strips insignificant trailing zeros so `1.50` and `1.5` compare equal; doubles compare by value. */
export function normalizeNumbers(text: string): string {
  return text.replace(/(Number|Decimal)\(([^)]*)\)/g, (_, kind: string, n: string) =>
    kind === "Number"
      ? `Number(${Number(n)})`
      : `Decimal(${n.includes(".") ? n.replace(/\.?0+$/, "") : n})`,
  );
}

export function renderType(t: FormulaType): string {
  switch (t.kind) {
    case "Decimal":
      return "Decimal";
    case "Record":
      return `{${[...t.fields]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((f) => `${f.name}:${renderType(f.type)}`)
        .join(",")}}`;
    case "Table":
      return `Table${renderType(t.row)}`;
    default:
      return t.kind;
  }
}

export function renderValue(engine: Engine, v: FormulaValue): string {
  switch (v.kind) {
    case "Blank":
      return "Blank";
    case "Number":
      return `Number(${engine.formatNumber(v.value)})`;
    case "Decimal":
      return `Decimal(${engine.formatDecimal(v.value)})`;
    case "Text":
      return JSON.stringify(v.value);
    case "Boolean":
      return String(v.value);
    case "Error":
      return `Error(${v.errors.map((e) => e.kind).join("+")})`;
    case "Record":
      return `{${v.fields.map((f) => `${f.name}:${renderValue(engine, f.value)}`).join(",")}}`;
    case "Table":
      return `Table[${v.rows.map((r) => renderValue(engine, r)).join(",")}]`;
  }
}

/** Registers one test per reference row, comparing static type and canonical result. */
export function replayRows(
  engine: Engine,
  rows: readonly { expr: string; type: string; result: string }[],
): void {
  for (const row of rows) {
    it(row.expr, async () => {
      const checked = engine.check(row.expr);
      if (row.result.startsWith("ERRORS:")) {
        expect(checked.ok).toBe(false);
        const actual = checked.diagnostics.map(
          (d) => `Error ${d.span.start}-${d.span.end}: ${d.message}`,
        );
        for (const expected of row.result.slice("ERRORS:".length).split("|")) {
          expect(actual, `missing: ${expected}`).toContain(expected);
        }
        return;
      }
      expect(checked.diagnostics, "no diagnostics").toEqual([]);
      expect(renderType(checked.type)).toBe(row.type);
      const result = await engine.evaluate(row.expr);
      if (result.kind !== "value") throw new Error(`expected a value, got ${result.kind}`);
      expect(normalizeNumbers(renderValue(engine, result.value))).toBe(
        normalizeNumbers(row.result),
      );
    });
  }
}
