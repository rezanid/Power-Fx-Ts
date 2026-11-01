import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, recordType, tableType } from "@powerfx-ts/core";
import { EvaluationBudgetExceeded } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";

interface AddColumnsProbe {
  readonly expression: string;
  readonly status: "valid" | "invalid";
  readonly typeOrder: string;
  readonly runtimeOrder: string;
  readonly serialized: string;
  readonly diagnostics: string;
  readonly runtimeException: string;
}

function loadAddColumnsProbes(file: string): AddColumnsProbe[] {
  const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [
        expression = "",
        status = "invalid",
        typeOrder = "",
        runtimeOrder = "",
        serialized = "",
        diagnostics = "",
        runtimeException = "-",
      ] = line.split("\t");
      return {
        expression,
        status: status as AddColumnsProbe["status"],
        typeOrder,
        runtimeOrder,
        serialized,
        diagnostics,
        runtimeException,
      };
    });
}

function fieldOrder(value: {
  readonly kind: string;
  readonly fields?: readonly { readonly name: string }[];
  readonly rows?: readonly {
    readonly kind: string;
    readonly fields?: readonly { readonly name: string }[];
  }[];
}): string {
  if (value.kind === "Record") return value.fields?.map((field) => field.name).join(",") ?? "";
  if (value.kind === "Table") {
    return (
      value.rows
        ?.map((row) =>
          row.kind === "Record"
            ? (row.fields?.map((field) => field.name).join(",") ?? "")
            : row.kind,
        )
        .join(";") ?? ""
    );
  }
  return value.kind;
}

describe.each(["float", "decimal"] as const)("AddColumns reference behavior (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  replayRows(
    engine,
    loadRows(`addcolumns-replay.${mode}.tsv`).filter((row) => row.expr.startsWith("AddColumns(")),
  );

  it("matches the separately observed schema, runtime, and serialized field order", async () => {
    const probes = loadAddColumnsProbes(`addcolumns-probe.${mode}.tsv`);
    const source = probes.find((probe) => probe.expression === "{z:3,a:1,m:2}");
    const record = probes.find((probe) => probe.expression.startsWith("AddColumns({z:3,a:1,m:2}"));
    const table = probes.find((probe) =>
      probe.expression.startsWith("AddColumns(Table({z:3,a:1,m:2}"),
    );
    if (source === undefined || record === undefined || table === undefined) {
      throw new Error("Missing AddColumns ordering reference probes.");
    }

    expect(source.typeOrder).toBe("a,m,z");
    expect(source.runtimeOrder).toBe("a,m,z");
    for (const probe of [record, table]) {
      expect(probe.status).toBe("valid");
      const checked = engine.check(probe.expression);
      expect(checked.ok, probe.expression).toBe(true);
      const typeFields =
        checked.type.kind === "Record"
          ? checked.type.fields
          : checked.type.kind === "Table"
            ? checked.type.row.fields
            : [];
      expect(typeFields.map((field) => field.name).join(",")).toBe(probe.typeOrder);
      const result = await engine.evaluate(probe.expression);
      if (result.kind !== "value") throw new Error(`Expected value: ${probe.expression}`);
      expect(fieldOrder(result.value)).toBe(probe.runtimeOrder);
      let previousIndex = -1;
      for (const name of probe.typeOrder.split(",")) {
        const index = probe.serialized.indexOf(`${name}:`);
        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }
    }
    expect(record.typeOrder).toBe("a,b,c,m,z");
    expect(table.typeOrder).toBe("a,b,c,m,z");
  });

  it("preserves collision warning severity alongside the invalid-arguments error", () => {
    for (const expression of ["AddColumns({a:1},a,2)", "AddColumns({a:1},x,1,y,2,x,3)"]) {
      const checked = engine.check(expression);
      expect(checked.ok).toBe(false);
      expect(checked.diagnostics.map(({ severity, message }) => [severity, message])).toEqual([
        [
          "warning",
          expression.includes("x,3")
            ? "Column name conflict for 'x'."
            : "A column named 'a' already exists.",
        ],
        ["error", "The function 'AddColumns' has some invalid arguments."],
      ]);
    }
  });

  it("checks recursive immutability and budgets each row and each addition expression", async () => {
    const schema = defineSchema({
      Input: recordType({
        z: NumberType,
        a: recordType({ nested: NumberType }),
      }),
      Rows: tableType([
        { name: "a", type: NumberType },
        { name: "z", type: NumberType },
      ]),
    });
    const validated = engine.validateValues(schema, {
      Input: { z: 3, a: { nested: 1 } },
      Rows: [
        { a: 1, z: 3 },
        { a: 2, z: 4 },
      ],
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));

    const recordCheck = engine.check("AddColumns(Input,first,1,second,2)", { schema });
    expect(recordCheck.ok).toBe(true);
    await expect(
      new Engine({ numberMode: mode, maxSteps: 6 }).evaluateChecked(recordCheck, {
        values: validated.values,
      }),
    ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    const recordResult = await engine.evaluateChecked(recordCheck, {
      values: validated.values,
    });
    if (recordResult.kind !== "value" || recordResult.value.kind !== "Record") {
      throw new Error("Expected an augmented record.");
    }
    expect(Object.isFrozen(recordResult.value)).toBe(true);
    expect(Object.isFrozen(recordResult.value.fields)).toBe(true);
    const nested = recordResult.value.fields.find((field) => field.name === "a")?.value;
    if (nested?.kind !== "Record") throw new Error("Expected a nested record.");
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.fields)).toBe(true);
    expect(fieldOrder(recordResult.value)).toBe("a,first,second,z");

    const tableCheck = engine.check("AddColumns(Rows,added,a+1)", { schema });
    expect(tableCheck.ok).toBe(true);
    await expect(
      new Engine({ numberMode: mode, maxSteps: 7 }).evaluateChecked(tableCheck, {
        values: validated.values,
      }),
    ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    const tableResult = await engine.evaluateChecked(tableCheck, {
      values: validated.values,
    });
    if (tableResult.kind !== "value" || tableResult.value.kind !== "Table") {
      throw new Error("Expected an augmented table.");
    }
    expect(tableResult.value.rows.map(fieldOrder)).toEqual(["a,added,z", "a,added,z"]);
    expect(Object.isFrozen(tableResult.value)).toBe(true);
    expect(Object.isFrozen(tableResult.value.rows)).toBe(true);
    for (const row of tableResult.value.rows) {
      expect(Object.isFrozen(row)).toBe(true);
      if (row.kind === "Record") expect(Object.isFrozen(row.fields)).toBe(true);
    }
  });

  it("checks cancellation at each table row and before each addition expression", async () => {
    const schema = defineSchema({
      Input: recordType({ a: NumberType }),
      Rows: tableType([{ name: "a", type: NumberType }]),
    });
    const validated = engine.validateValues(schema, {
      Input: { a: 1 },
      Rows: [{ a: 1 }, { a: 2 }],
    });
    if (!validated.ok) throw new Error(JSON.stringify(validated.issues));

    const check = engine.check("AddColumns(Rows,x,1)", { schema });
    const rowState = { checks: 0 };
    const rowReason = new Error("cancel before second row");
    const rowSignal = {
      get aborted() {
        return false;
      },
      throwIfAborted() {
        rowState.checks++;
        if (rowState.checks === 6) throw rowReason;
      },
    };
    await expect(
      engine.evaluateChecked(check, { values: validated.values, signal: rowSignal }),
    ).rejects.toBe(rowReason);
    expect(rowState.checks).toBe(6);

    const recordCheck = engine.check("AddColumns(Input,x,1,y,2)", { schema });
    const expressionState = { checks: 0 };
    const expressionReason = new Error("cancel before second expression");
    const expressionSignal = {
      get aborted() {
        return false;
      },
      throwIfAborted() {
        expressionState.checks++;
        if (expressionState.checks === 6) throw expressionReason;
      },
    };
    await expect(
      engine.evaluateChecked(recordCheck, {
        values: validated.values,
        signal: expressionSignal,
      }),
    ).rejects.toBe(expressionReason);
    expect(expressionState.checks).toBe(6);
  });
});
