import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, tableType } from "@powerfx-ts/core";
import { EvaluationBudgetExceeded } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";

interface RenameProbe {
  readonly expression: string;
  readonly status: "valid" | "invalid";
  readonly typeOrder: string;
  readonly runtimeOrder: string;
  readonly serialized: string;
  readonly diagnostics: string;
  readonly runtimeException: string;
}

function loadRenameProbes(file: string): RenameProbe[] {
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
        status: status as RenameProbe["status"],
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

describe.each(["float", "decimal"] as const)("RenameColumns reference behavior (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  replayRows(engine, loadRows(`renamecolumns-replay.${mode}.tsv`));

  it("matches the reference's independently observed schema, runtime, and serialized field order", async () => {
    const probes = loadRenameProbes(`renamecolumns-order.${mode}.tsv`);
    const source = probes.find((probe) => probe.expression === "{z:3,a:1,m:2}");
    const renamed = probes.find((probe) => probe.expression.endsWith("z, b)"));
    const simultaneous = probes.find((probe) => probe.expression.includes("a, x, z, y"));
    if (source === undefined || renamed === undefined || simultaneous === undefined) {
      throw new Error("Missing field-order reference probes.");
    }

    expect(source.typeOrder).toBe("a,m,z");
    expect(source.runtimeOrder).toBe("a,m,z");
    expect(source.serialized.indexOf("a:")).toBeLessThan(source.serialized.indexOf("m:"));
    expect(source.serialized.indexOf("m:")).toBeLessThan(source.serialized.indexOf("z:"));

    for (const probe of [renamed, simultaneous]) {
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
    expect(renamed.typeOrder).toBe("a,b,m");
    expect(simultaneous.typeOrder).toBe("m,x,y");
  });

  it("keeps the no-op valid and rejects repeated no-op sources as the approved deviation", async () => {
    const deviationProbes = loadRenameProbes(`renamecolumns-deviation.${mode}.tsv`);
    expect(deviationProbes).toHaveLength(2);
    for (const probe of deviationProbes) {
      expect(probe.status).toBe("valid");
      expect(probe.runtimeException).toBe(
        "An item with the same key has already been added. Key: a",
      );
      const checked = engine.check(probe.expression);
      expect(checked.ok).toBe(false);
      expect(checked.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
        "The specified column 'a' cannot be renamed twice.",
        "The function 'RenameColumns' has some invalid arguments.",
      ]);
    }

    const noOp = await engine.evaluate("RenameColumns({a:1,b:2}, b, b)");
    if (noOp.kind !== "value" || noOp.value.kind !== "Record") {
      throw new Error("Expected no-op rename to return a record.");
    }
    expect(noOp.value.fields.map((field) => field.name)).toEqual(["a", "b"]);
  });

  it("preserves recursively frozen values and checks budget and cancellation for each row", async () => {
    const expression = "RenameColumns(Table({z:3,a:{nested:1},m:2},{z:6,a:{nested:4},m:5}), z, b)";
    const result = await engine.evaluate(expression);
    if (result.kind !== "value" || result.value.kind !== "Table") {
      throw new Error("Expected a renamed table.");
    }
    expect(result.value.rows.map(fieldOrder)).toEqual(["a,b,m", "a,b,m"]);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.rows)).toBe(true);
    const first = result.value.rows[0];
    if (first?.kind !== "Record") throw new Error("Expected record row.");
    const nested = first.fields.find((field) => field.name === "a")?.value;
    if (nested?.kind !== "Record") throw new Error("Expected nested record.");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fields)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.fields)).toBe(true);

    const schema = defineSchema({
      Rows: tableType([
        { name: "z", type: NumberType },
        { name: "a", type: NumberType },
      ]),
    });
    const checked = engine.check("RenameColumns(Rows,z,b)", { schema });
    expect(checked.ok).toBe(true);
    const validated = engine.validateValues(schema, {
      Rows: [
        { z: 3, a: 1 },
        { z: 6, a: 4 },
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
