import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EvaluationBudgetExceeded, type FormulaValue } from "@powerfx-ts/interpreter";
import type { FormulaType } from "@powerfx-ts/core";
import { Engine } from "../src/index.js";

// Differential tests for `Coalesce` (docs/adr/0012-coalesce.md). The three fixtures are the verbatim
// output of the pinned upstream C# implementation (tools/reference-harness `probe`):
//   dotnet run --project tools/reference-harness -- probe <float|decimal> \
//     packages/engine/test/fixtures/coalesce-probe.expressions.txt > coalesce-probe.<mode>.tsv
// Each row is `expression<TAB>static type<TAB>result`, where a result starting with `ERRORS:` lists
// the compile errors (`Error start-end: message`, `|`-separated) instead of a value.

const engines = { float: new Engine(), decimal: new Engine({ numberMode: "decimal" }) };

function loadRows(mode: "float" | "decimal"): { expr: string; type: string; result: string }[] {
  const text = readFileSync(
    new URL(`./fixtures/coalesce-probe.${mode}.tsv`, import.meta.url),
    "utf8",
  );
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const [expr = "", type = "", result = ""] = line.split("\t");
      return { expr, type, result };
    });
}

/** Strips insignificant trailing zeros so `1.50` and `1.5` compare equal; doubles compare by value. */
function normalizeNumbers(text: string): string {
  return text.replace(/(Number|Decimal)\(([^)]*)\)/g, (_, kind: string, n: string) =>
    kind === "Number"
      ? `Number(${Number(n)})`
      : `Decimal(${n.includes(".") ? n.replace(/\.?0+$/, "") : n})`,
  );
}

function renderType(t: FormulaType): string {
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

function renderValue(engine: Engine, v: FormulaValue): string {
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

describe.each(["float", "decimal"] as const)("Coalesce matches the reference (%s)", (mode) => {
  const engine = engines[mode];
  for (const row of loadRows(mode)) {
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
});

describe("Coalesce evaluation contract", () => {
  const engine = new Engine();
  const steps = (text: string, maxSteps: number) =>
    new Engine({ maxSteps }).evaluate(text).then((r) => r.kind);

  it("does not evaluate (or charge for) arguments after the selected one", async () => {
    // `Coalesce(5, 1/0)`: literal 5 (1 node) + Call (1 node); the skipped `1/0` would add 3 more.
    expect(await steps("Coalesce(5, 1/0)", 2)).toBe("value");
    await expect(steps("Coalesce(5, 1/0)", 1)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
  });

  it("charges for every evaluated argument", async () => {
    // Call + Blank() + Blank() + 3 = 4 nodes... Blank() is a call node each.
    await expect(steps("Coalesce(Blank(), Blank(), 3)", 3)).rejects.toBeInstanceOf(
      EvaluationBudgetExceeded,
    );
    expect(await steps("Coalesce(Blank(), Blank(), 3)", 4)).toBe("value");
  });

  it("stops at a reached error without evaluating later arguments", async () => {
    await expect(steps("Coalesce(1/0, 2)", 3)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    expect(await steps("Coalesce(1/0, 2)", 4)).toBe("value");
    expect(await steps("Coalesce(1/0, 1/0, 1/0)", 4)).toBe("value");
  });

  it("observes cancellation before evaluating each argument", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      engine.evaluate("Coalesce(Blank(), 1)", { signal: controller.signal }),
    ).rejects.toThrow("stop");
  });

  it("observes budget exhaustion while conforming table rows", async () => {
    const formula = "Coalesce(If(false,[{a:1}]), [{b:2},{b:3},{b:4}])";
    const needed = (() => {
      let n = 1;
      return async () => {
        while ((await steps(formula, n).catch(() => "budget")) === "budget") n++;
        return n;
      };
    })();
    const exact = await needed();
    await expect(steps(formula, exact - 1)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    // Conformance visits each of the 3 rows: an unconformed table needs fewer steps.
    expect(await steps("Coalesce(If(false,[{b:1}]), [{b:2},{b:3},{b:4}])", exact - 3)).toBe(
      "value",
    );
  });

  it("returns frozen results, including nested records and error arrays", async () => {
    const record = await engine.evaluate("Coalesce(If(false,{a:1}), {b:{c:2}})");
    if (record.kind !== "value" || record.value.kind !== "Record") throw new Error("record");
    expect(Object.isFrozen(record.value)).toBe(true);
    expect(Object.isFrozen(record.value.fields)).toBe(true);
    const nested = record.value.fields[1]!.value;
    expect(Object.isFrozen(nested)).toBe(true);

    const merged = await engine.evaluate('Coalesce(Blank(), (1/0)+(1+"x"), 1)');
    if (merged.kind !== "value" || merged.value.kind !== "Error") throw new Error("error");
    expect(merged.value.errors.map((e) => e.kind)).toEqual(["Div0", "InvalidArgument"]);
    expect(Object.isFrozen(merged.value)).toBe(true);
    expect(Object.isFrozen(merged.value.errors)).toBe(true);
    expect(merged.value.errors.every((e) => Object.isFrozen(e))).toBe(true);

    const decimal = await new Engine({ numberMode: "decimal" }).evaluate(
      'Coalesce("", Decimal("1.5"), 1)',
    );
    if (decimal.kind !== "value") throw new Error("decimal");
    expect(Object.isFrozen(decimal.value)).toBe(true);
  });
});
