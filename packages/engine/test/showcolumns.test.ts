import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, tableType } from "@powerfx-ts/core";
import { EvaluationBudgetExceeded } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";

interface OrderProbe {
  readonly expression: string;
  readonly status: "valid" | "invalid";
  readonly typeOrder: string;
  readonly runtimeOrder: string;
  readonly serialized: string;
  readonly diagnostics: string;
}

function loadOrderProbes(mode: "float" | "decimal"): OrderProbe[] {
  const text = readFileSync(
    new URL(`./fixtures/showcolumns-order.${mode}.tsv`, import.meta.url),
    "utf8",
  );
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
      ] = line.split("\t");
      return {
        expression,
        status: status as OrderProbe["status"],
        typeOrder,
        runtimeOrder,
        serialized,
        diagnostics: diagnostics === "-" ? "" : diagnostics,
      };
    });
}

function diagnosticSignature(
  severity: string,
  start: number,
  end: number,
  message: string,
): string {
  return `${severity}@${start}-${end}:${message}`;
}

describe.each(["float", "decimal"] as const)("ShowColumns matches the reference (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  replayRows(engine, loadRows(`showcolumns-probe.${mode}.tsv`));

  it("keeps schema order independent of argument order and serialized field order", async () => {
    const allProbes = loadOrderProbes(mode);
    const sourceProbe = allProbes.find((probe) => probe.expression === "{z:3,a:1,m:2}");
    if (sourceProbe === undefined) throw new Error("Missing unordered source reference probe.");
    expect(sourceProbe.typeOrder).toBe("a,m,z");
    expect(sourceProbe.runtimeOrder).toBe("a,m,z");
    expect(sourceProbe.serialized.indexOf("a:")).toBeLessThan(sourceProbe.serialized.indexOf("m:"));
    expect(sourceProbe.serialized.indexOf("m:")).toBeLessThan(sourceProbe.serialized.indexOf("z:"));

    const probes = allProbes.filter(
      (probe) => probe.status === "valid" && probe.expression.startsWith("ShowColumns("),
    );
    for (const probe of probes) {
      const checked = engine.check(probe.expression);
      expect(checked.ok, probe.expression).toBe(true);
      const typeFields =
        checked.type.kind === "Record"
          ? checked.type.fields
          : checked.type.kind === "Table"
            ? checked.type.row.fields
            : [];
      expect(typeFields.map((field) => field.name).join(","), probe.expression).toBe(
        probe.typeOrder,
      );

      const result = await engine.evaluate(probe.expression);
      if (result.kind !== "value") throw new Error(`Expected a value for ${probe.expression}`);
      const runtimeOrder =
        result.value.kind === "Record"
          ? result.value.fields.map((field) => field.name).join(",")
          : result.value.kind === "Table"
            ? result.value.rows
                .map((row) =>
                  row.kind === "Record"
                    ? row.fields.map((field) => field.name).join(",")
                    : row.kind === "Blank"
                      ? "Blank"
                      : "ErrorValue",
                )
                .join(";")
            : result.value.kind === "Blank"
              ? "BlankValue"
              : result.value.kind === "Error"
                ? "ErrorValue"
                : result.value.kind;
      expect(runtimeOrder, probe.expression).toBe(probe.runtimeOrder);

      if (probe.expression === "ShowColumns({z:3,a:1,m:2}, z, m)") {
        expect(probe.typeOrder).toBe("m,z");
        expect(probe.runtimeOrder).toBe("m,z");
        expect(probe.serialized).toContain("{m:");
        expect(probe.serialized.indexOf("m:")).toBeLessThan(probe.serialized.indexOf("z:"));
      }
    }
  });

  it("preserves duplicate-name warning severity and invalidates the call", () => {
    const probe = loadOrderProbes(mode).find((row) => row.expression.includes(", z, z"));
    if (probe === undefined) throw new Error("Missing duplicate-name reference probe.");
    const checked = engine.check(probe.expression);
    expect(checked.ok).toBe(false);
    const actual = checked.diagnostics.map((diagnostic) =>
      diagnosticSignature(
        diagnostic.severity === "warning" ? "Warning" : "Severe",
        diagnostic.span.start,
        diagnostic.span.end,
        diagnostic.message,
      ),
    );
    expect(actual).toEqual(probe.diagnostics.split("|"));
    expect(checked.diagnostics.some((diagnostic) => diagnostic.severity === "warning")).toBe(true);
    expect(
      checked.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "PFX2003" &&
          diagnostic.severity === "error" &&
          diagnostic.message === "The function 'ShowColumns' has some invalid arguments.",
      ),
    ).toBe(true);
  });

  it("does not resolve column identifiers as same-named variables", async () => {
    const result = await engine.evaluate(
      "With({z:99, source:{z:3,a:1,m:2}}, ShowColumns(source,z))",
    );
    if (result.kind !== "value" || result.value.kind !== "Record") {
      throw new Error("Expected the projected record.");
    }
    expect(result.value.fields.map((field) => field.name)).toEqual(["z"]);
    const value = result.value.fields[0]?.value;
    if (value?.kind !== "Number" && value?.kind !== "Decimal") {
      throw new Error("Expected the source field value.");
    }
    expect(
      value.kind === "Number"
        ? engine.formatNumber(value.value)
        : engine.formatDecimal(value.value),
    ).toBe("3");
  });

  it("preserves recursive immutability and charges/checks every table row", async () => {
    const expression = "ShowColumns(Table({z:3,a:1,m:{nested:2}},{z:6,a:4,m:{nested:5}}), z, m)";
    const result = await engine.evaluate(expression);
    if (result.kind !== "value" || result.value.kind !== "Table") {
      throw new Error("Expected a projected table.");
    }
    expect(
      result.value.rows.map((row) => (row.kind === "Record" ? row.fields.map((f) => f.name) : [])),
    ).toEqual([
      ["m", "z"],
      ["m", "z"],
    ]);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.rows)).toBe(true);
    for (const row of result.value.rows) {
      if (row.kind !== "Record") throw new Error("Expected a record row.");
      const nested = row.fields.find((field) => field.name === "m")?.value;
      if (nested?.kind !== "Record") throw new Error("Expected nested record.");
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.fields)).toBe(true);
      expect(Object.isFrozen(nested)).toBe(true);
      expect(Object.isFrozen(nested.fields)).toBe(true);
    }

    const schema = defineSchema({
      Rows: tableType([
        { name: "z", type: NumberType },
        { name: "a", type: NumberType },
      ]),
    });
    const checked = engine.check("ShowColumns(Rows,z)", { schema });
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
