import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, recordType, tableType, type BoundNode } from "@powerfx-ts/core";
import { EvaluationBudgetExceeded, floatBackend, type FormulaValue } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";
import { serializeValue } from "../../test-suite/src/engine-runner.js";

function assertFrozen(value: FormulaValue): void {
  expect(Object.isFrozen(value)).toBe(true);
  if (value.kind === "Record") {
    expect(Object.isFrozen(value.fields)).toBe(true);
    for (const field of value.fields) {
      expect(Object.isFrozen(field)).toBe(true);
      assertFrozen(field.value);
    }
  } else if (value.kind === "Table") {
    expect(Object.isFrozen(value.rows)).toBe(true);
    for (const row of value.rows) assertFrozen(row);
  } else if (value.kind === "Error") {
    expect(Object.isFrozen(value.errors)).toBe(true);
    for (const entry of value.errors) expect(Object.isFrozen(entry)).toBe(true);
  }
}

describe.each(["float", "decimal"] as const)("table selection (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  replayRows(engine, loadRows(`table-selection-probe.${mode}.tsv`));
  replayRows(engine, loadRows(`table-selection-boundary.${mode}.tsv`));
  replayRows(engine, loadRows(`table-selection-diagnostics.${mode}.tsv`));

  it("uses explicit Float count coercion even in decimal mode", () => {
    for (const name of ["FirstN", "LastN"]) {
      const checked = engine.check(`${name}([1],Decimal("1.9999999999999998"))`);
      expect(checked.ok).toBe(true);
      const bound = checked.bound;
      if (bound?.kind !== "FirstN" && bound?.kind !== "LastN") {
        throw new Error("Missing table selection node.");
      }
      expect(bound.count.kind).toBe("Coerce");
      expect(bound.count.type).toEqual(NumberType);
      const count: BoundNode = bound.count;
      if (count.kind !== "Coerce") throw new Error("Missing count coercion.");
      expect(count.operand.type.kind).toBe("Decimal");
    }
  });

  it("preserves source schema and observes field ordering separately from row order", async () => {
    const probes = readFileSync(
      new URL(`./fixtures/table-selection-order.${mode}.tsv`, import.meta.url),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    const [sourceExpression, , sourceSchema, sourceFields] = probes[0]!;
    if (sourceExpression === undefined) throw new Error("Missing ordering reference source.");
    expect(sourceSchema).toBe("a,m,z");
    expect(sourceFields).toBe("a,m,z;a,m,z");
    const source = await engine.evaluate(sourceExpression);
    if (source.kind !== "value" || source.value.kind !== "Table")
      throw new Error("Expected table.");

    for (const [expression, status, schemaOrder, runtimeOrder, serialized] of probes.slice(1)) {
      if (expression === undefined || serialized === undefined) throw new Error("Invalid probe.");
      expect(status).toBe("valid");
      const checked = engine.check(expression);
      expect(checked.ok).toBe(true);
      const fields =
        checked.type.kind === "Table"
          ? checked.type.row
          : checked.type.kind === "Record"
            ? checked.type
            : undefined;
      expect(fields?.fields.map((field) => field.name).join(",")).toBe(schemaOrder);
      const result = await engine.evaluate(expression);
      if (result.kind !== "value") throw new Error("Expected selected value.");
      const rows = result.value.kind === "Table" ? result.value.rows : [result.value];
      // Selection must not impose a new runtime field order on already evaluated records.
      for (const row of rows) {
        if (row.kind !== "Record" || source.value.rows[0]?.kind !== "Record") {
          throw new Error("Expected record row.");
        }
        expect(row.fields.map((field) => field.name)).toEqual(
          source.value.rows[0].fields.map((field) => field.name),
        );
      }
      expect(runtimeOrder).toBe(rows.map(() => "a,m,z").join(";"));
      if (rows.length > 0) {
        expect(serialized.indexOf("a:")).toBeLessThan(serialized.indexOf("m:"));
        expect(serialized.indexOf("m:")).toBeLessThan(serialized.indexOf("z:"));
        expect(serializeValue(result.value, engine)).toBe(
          serialized.replace(/(?:Float|Decimal)\((\d+)\)/g, "$1"),
        );
      } else {
        expect(serializeValue(result.value, engine)).toBe("Table()");
      }
      const selectedValues = rows.map((row) =>
        row.kind === "Record" ? row.fields.find((field) => field.name === "a")?.value : undefined,
      );
      const expected = expression.startsWith("FirstN")
        ? expression.endsWith(",0)")
          ? []
          : ["1"]
        : expression.endsWith(",2)")
          ? ["1", "4"]
          : ["4"];
      expect(
        selectedValues.map((value) => {
          if (value?.kind === "Number") return engine.formatNumber(value.value);
          if (value?.kind === "Decimal") return engine.formatDecimal(value.value);
          throw new Error("Expected a numeric field.");
        }),
      ).toEqual(expected);
    }
  });

  it("retains schema field order and shares immutable source rows without copying records", async () => {
    const schema = defineSchema({
      Rows: tableType([
        { name: "z", type: recordType({ nested: NumberType }) },
        { name: "a", type: NumberType },
      ]),
      N: NumberType,
    });
    const input = {
      Rows: [
        { z: { nested: 1 }, a: 10 },
        { z: { nested: 2 }, a: 20 },
      ],
      N: 1,
    };
    const validated = engine.validateValues(schema, input);
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));
    const source = validated.values.values.get("Rows");
    if (source?.kind !== "Table") throw new Error("Expected validated rows.");
    for (const formula of ["FirstN(Rows,N)", "Last(Rows)", "LastN(Rows,N)"]) {
      const checked = engine.check(formula, { schema });
      expect(checked.ok).toBe(true);
      const expectedType = sourceType(schema);
      expect(checked.type).toEqual(formula.startsWith("Last(") ? expectedType.row : expectedType);
      const result = await engine.evaluateChecked(checked, { values: validated.values });
      if (result.kind !== "value") throw new Error("Expected result.");
      const selected = result.value.kind === "Table" ? result.value.rows[0] : result.value;
      expect(selected).toBe(source.rows[formula.startsWith("FirstN") ? 0 : 1]);
      assertFrozen(result.value);
    }
    expect(input.Rows).toEqual([
      { z: { nested: 1 }, a: 10 },
      { z: { nested: 2 }, a: 20 },
    ]);
    assertFrozen(source);
  });

  it("recursively freezes retained row errors and ordered combined errors", async () => {
    for (const expression of [
      "LastN(Table({a:{nested:1}},If(1/0=0,{a:{nested:2}})),2)",
      'FirstN(If(1/0=0,[1]),"bad")',
      "Last(Table({a:1},If(1/0=0,{a:2})))",
    ]) {
      const result = await engine.evaluate(expression);
      if (result.kind !== "value") throw new Error("Expected value.");
      assertFrozen(result.value);
    }
  });

  it("budgets prefix selection, full LastN traversal including count zero, and direct Last access", async () => {
    const schema = defineSchema({
      Rows: tableType([{ name: "a", type: NumberType }]),
      N: NumberType,
    });
    for (const n of [-1, 0, 1, 2, 100]) {
      const validated = engine.validateValues(schema, {
        Rows: [{ a: 1 }, { a: 2 }, { a: 3 }],
        N: n,
      });
      if (!validated.ok) throw new Error("Invalid host input.");
      for (const [formula, steps] of [
        ["FirstN(Rows,N)", 3 + Math.min(Math.max(0, n), 3)],
        ["LastN(Rows,N)", 6],
        ["Last(Rows)", 3],
      ] as const) {
        const checked = engine.check(formula, { schema });
        const run = (maxSteps: number) =>
          new Engine({ numberMode: mode, maxSteps }).evaluateChecked(checked, {
            values: validated.values,
          });
        await expect(run(steps)).resolves.toMatchObject({ kind: "value" });
        await expect(run(steps - 1)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
      }
    }
  });

  it("checks cancellation during selection and source construction, without reevaluating rows", async () => {
    const schema = defineSchema({
      Rows: tableType([{ name: "a", type: NumberType }]),
      N: NumberType,
    });
    const validated = engine.validateValues(schema, { Rows: [{ a: 1 }, { a: 2 }, { a: 3 }], N: 2 });
    if (!validated.ok) throw new Error("Invalid host input.");
    for (const formula of ["FirstN(Rows,N)", "LastN(Rows,N)", "Last(Rows)"]) {
      let calls = 0;
      const reason = new Error("cancel during row selection");
      const signal = {
        aborted: false,
        throwIfAborted() {
          if (++calls === (formula.startsWith("Last(") ? 3 : 5)) throw reason;
        },
      };
      await expect(
        engine.evaluate(formula, { schema, values: validated.values, signal }),
      ).rejects.toBe(reason);
    }
    for (const name of ["FirstN", "LastN"]) {
      const zero = engine.validateValues(schema, { Rows: [{ a: 1 }, { a: 2 }], N: 0 });
      if (!zero.ok) throw new Error("Invalid host input.");
      const checked = engine.check(`${name}(AddColumns(Rows,b,a+1),N)`, { schema });
      await expect(
        new Engine({ numberMode: mode, maxSteps: 3 }).evaluateChecked(checked, {
          values: zero.values,
        }),
      ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    }
  });

  it("rejects nonfinite host counts instead of normalizing them", () => {
    const schema = defineSchema({ N: NumberType });
    for (const n of [NaN, Infinity, -Infinity]) {
      expect(engine.validateValues(schema, { N: n }).ok).toBe(false);
    }
  });

  it.each([NaN, Infinity, -Infinity])(
    "returns Numeric for a nonfinite backend count (%s)",
    async (n) => {
      const custom = new Engine({
        numberMode: mode,
        numeric: { ...floatBackend, toNumber: () => n },
      });
      for (const name of ["FirstN", "LastN"]) {
        const result = await custom.evaluate(`${name}([1,2],1)`);
        expect(result).toMatchObject({
          kind: "value",
          value: { kind: "Error", errors: [{ kind: "Numeric" }] },
        });
      }
    },
  );
});

function sourceType(schema: ReturnType<typeof defineSchema>) {
  const type = schema.variables.find((variable) => variable.name === "Rows")?.type;
  if (type?.kind !== "Table") throw new Error("Expected table schema.");
  return type;
}
