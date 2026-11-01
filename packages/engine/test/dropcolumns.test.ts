import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, recordType, tableType } from "@powerfx-ts/core";
import { EvaluationBudgetExceeded } from "@powerfx-ts/interpreter";
import { loadRows, replayRows } from "./reference-probe.js";
import { Engine } from "../src/index.js";

describe.each(["float", "decimal"] as const)("DropColumns matches the reference (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });

  replayRows(engine, loadRows(`dropcolumns-probe.${mode}.tsv`));

  it("binds column identifiers without resolving same-named schema variables", async () => {
    const schema = defineSchema({
      source: recordType({ a: NumberType, b: NumberType }),
      b: NumberType,
    });
    const checked = engine.check("DropColumns(source,b)", { schema });
    expect(checked.ok).toBe(true);
    expect(checked.type).toEqual(recordType({ a: NumberType }));

    const validated = engine.validateValues(schema, { source: { a: 1, b: 2 }, b: 99 });
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    const result = await engine.evaluateChecked(checked, { values: validated.values });
    expect(result.kind).toBe("value");
    if (result.kind !== "value" || result.value.kind !== "Record") {
      throw new Error("expected a projected record");
    }
    expect(result.value.fields.map((field) => field.name)).toEqual(["a"]);
  });

  it("preserves row order, retained nested values, and recursive immutability", async () => {
    const result = await engine.evaluate(
      "DropColumns(Table({keep:{nested:1},drop:20},{keep:{nested:2},drop:10}),drop)",
    );
    if (result.kind !== "value" || result.value.kind !== "Table") {
      throw new Error("expected a projected table");
    }
    expect(result.value.rows).toHaveLength(2);
    const rows = result.value.rows;
    const retainedValues = rows.map((row) => {
      if (row.kind !== "Record") throw new Error("expected a record row");
      const kept = row.fields.find((field) => field.name === "keep")?.value;
      if (kept?.kind !== "Record") throw new Error("expected the nested retained record");
      const nested = kept.fields.find((field) => field.name === "nested")?.value;
      if (nested?.kind === "Number") return engine.formatNumber(nested.value);
      if (nested?.kind === "Decimal") return engine.formatDecimal(nested.value);
      throw new Error("expected a numeric nested field");
    });
    expect(retainedValues).toEqual(["1", "2"]);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(rows)).toBe(true);
    for (const row of rows) {
      if (row.kind !== "Record") throw new Error("expected a record row");
      const kept = row.fields[0]?.value;
      if (kept?.kind !== "Record") throw new Error("expected the nested retained record");
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.fields)).toBe(true);
      expect(Object.isFrozen(row.fields[0])).toBe(true);
      expect(Object.isFrozen(kept)).toBe(true);
      expect(Object.isFrozen(kept.fields)).toBe(true);
      expect(Object.isFrozen(kept.fields[0])).toBe(true);
    }
  });

  it("charges and checks cancellation once for each projected table row", async () => {
    const schema = defineSchema({
      Rows: tableType([
        { name: "a", type: NumberType },
        { name: "b", type: NumberType },
      ]),
    });
    const checked = engine.check("DropColumns(Rows,b)", { schema });
    const validated = engine.validateValues(schema, {
      Rows: [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));

    const run = (maxSteps: number) =>
      new Engine({ numberMode: mode, maxSteps }).evaluateChecked(checked, {
        values: validated.values,
      });
    await expect(run(3)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    expect((await run(4)).kind).toBe("value");

    const state = { checks: 0 };
    const reason = new Error("stop-now");
    const signal = {
      get aborted() {
        return false;
      },
      throwIfAborted() {
        state.checks++;
        if (state.checks === 4) throw reason;
      },
    };
    await expect(
      engine.evaluateChecked(checked, { values: validated.values, signal }),
    ).rejects.toBe(reason);
    expect(state.checks).toBe(4);
  });
});
