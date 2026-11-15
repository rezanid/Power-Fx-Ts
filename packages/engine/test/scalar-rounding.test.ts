import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, DecimalType } from "@powerfx-ts/core";
import {
  EvaluationBudgetExceeded,
  decimalBackend,
  floatBackend,
  type NumericBackend,
  type NumericValue,
} from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows, renderValue } from "./reference-probe.js";

const names = ["Round", "RoundDown", "RoundUp"] as const;

describe.each(["float", "decimal"] as const)("scalar rounding (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  replayRows(engine, loadRows(`scalar-rounding.${mode}.tsv`));

  it("requires two arguments and binds explicit operand and Float precision coercions", () => {
    for (const name of names) {
      const checked = engine.check(`${name}("12.34",Decimal("1.9999999999999998"))`);
      expect(checked.ok).toBe(true);
      expect(checked.type.kind).toBe(mode === "decimal" ? "Decimal" : "Number");
      if (checked.bound?.kind !== "Call") throw new Error("Expected call.");
      expect(checked.bound.args[0]).toMatchObject({
        kind: "Coerce",
        to: mode === "decimal" ? "Decimal" : "Number",
      });
      expect(checked.bound.args[1]).toMatchObject({ kind: "Coerce", to: "Number" });
      expect(engine.check(`${name}(Float(1),Decimal(2))`).type.kind).toBe("Number");
      expect(engine.check(`${name}(Decimal(1),Float(2))`).type.kind).toBe("Decimal");
      for (const args of ["", "1", "1,2,3"]) {
        const invalid = engine.check(`${name}(${args})`);
        expect(invalid.ok).toBe(false);
        expect(invalid.diagnostics).toHaveLength(1);
        expect(invalid.diagnostics[0]?.message).toContain("expected 2");
      }
      expect(engine.check(`${name}({x:1},0)`).diagnostics).toHaveLength(2);
      expect(engine.check(`${name}(1,{x:1})`).diagnostics).toHaveLength(2);
    }
    expect(engine.check("Round(Round(1e400,0),0)").diagnostics).toHaveLength(3);
    expect(engine.check("RoundUp(missing,RoundDown(1e400,0))").diagnostics).toHaveLength(5);
  });

  it("preserves valid table overloads as unsupported", async () => {
    for (const name of names) {
      for (const args of ["[1,2],0", "1,[0,1]", "[1,2],[0,1]"]) {
        expect(await engine.evaluate(`${name}(${args})`)).toMatchObject({ kind: "unsupported" });
      }
      expect(await engine.evaluate(`${name}({x:1},0)`)).toMatchObject({ kind: "invalid" });
    }
  });

  it("preserves RoundDown and Trunc equality including signed zero at boundaries", async () => {
    const operands = [
      'Float("-0")',
      'Float("-5e-324")',
      'Float("0.29")',
      'Float("1e20")',
      'Decimal("1e-28")',
      'Decimal("4.9999999999999999999999999999")',
      'Decimal("-79228162514264337593543950335")',
    ];
    for (const operand of operands) {
      for (const precision of [
        -2147483649, -29, -28, -16, -15, -1, -0.9, 0, 2, 15, 16, 28, 29, 2147483648,
      ]) {
        const down = await engine.evaluate(`RoundDown(${operand},Float("${precision}"))`);
        const trunc = await engine.evaluate(`Trunc(${operand},Float("${precision}"))`);
        if (down.kind !== "value" || trunc.kind !== "value") throw new Error("Expected values.");
        expect(renderValue(engine, down.value)).toBe(renderValue(engine, trunc.value));
      }
    }
  });

  it("freezes numbers, exact Decimal payloads, and ordered error graphs", async () => {
    for (const name of names) {
      for (const args of ["Float(-1.25),1", 'Decimal("-1.25"),1', '1/0,"bad"']) {
        const result = await engine.evaluate(`${name}(${args})`);
        if (result.kind !== "value") throw new Error("Expected value.");
        expect(Object.isFrozen(result.value)).toBe(true);
        if (result.value.kind === "Decimal") expect(Object.isFrozen(result.value.value)).toBe(true);
        if (result.value.kind === "Error") {
          expect(result.value.errors.map((entry) => entry.kind)).toEqual([
            "Div0",
            "InvalidArgument",
          ]);
          expect(Object.isFrozen(result.value.errors)).toBe(true);
          for (const entry of result.value.errors) expect(Object.isFrozen(entry)).toBe(true);
        }
      }
    }
  });

  it("checks each eager argument for budgets and cancellation, even after errors", async () => {
    const schema = defineSchema({ X: NumberType, P: NumberType });
    const values = engine.validateValues(schema, { X: -1.25, P: 1 });
    if (!values.ok) throw new Error("Invalid input.");
    for (const name of names) {
      const checked = engine.check(`${name}(X,P)`, { schema });
      await expect(
        new Engine({ numberMode: mode, maxSteps: 3 }).evaluateChecked(checked, {
          values: values.values,
        }),
      ).resolves.toMatchObject({ kind: "value" });
      await expect(
        new Engine({ numberMode: mode, maxSteps: 2 }).evaluateChecked(checked, {
          values: values.values,
        }),
      ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
      for (const step of [2, 3]) {
        let calls = 0;
        const reason = new Error("cancel at argument");
        const signal = {
          aborted: false,
          throwIfAborted() {
            if (++calls === step) throw reason;
          },
        };
        await expect(
          engine.evaluateChecked(checked, { values: values.values, signal }),
        ).rejects.toBe(reason);
      }
      await expect(
        new Engine({ numberMode: mode, maxSteps: 4 }).evaluate(`${name}(1/0,1+2)`),
      ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    }
    for (const nonfinite of [NaN, Infinity, -Infinity]) {
      expect(engine.validateValues(schema, { X: nonfinite, P: 1 }).ok).toBe(false);
    }
  });

  it("keeps exact Decimal operands out of Number even during intermediate division", async () => {
    const exact: NumericBackend = {
      ...decimalBackend,
      toNumber() {
        throw new Error("Decimal operand converted through Number.");
      },
    };
    const custom = new Engine({ numberMode: mode, decimal: exact });
    const schema = defineSchema({ X: DecimalType, P: NumberType });
    for (const [operand, precision, expected] of [
      [
        "-1234567890123456789012345.678",
        2,
        [
          "-1234567890123456789012345.68",
          "-1234567890123456789012345.67",
          "-1234567890123456789012345.68",
        ],
      ],
      ["4.9999999999999999999999999999", -1, ["10", "0", "10"]],
      ["0.0000000000000000000000000001", -1, ["0", "0", "0"]],
    ] as const) {
      const input = custom.validateValues(schema, { X: operand, P: precision });
      if (!input.ok) throw new Error("Invalid input.");
      for (const [index, name] of names.entries()) {
        const result = await custom.evaluate(`${name}(X,P)`, { schema, values: input.values });
        if (result.kind !== "value" || result.value.kind !== "Decimal")
          throw new Error("Expected Decimal.");
        expect(custom.formatDecimal(result.value.value)).toBe(expected[index]);
      }
    }
  });
});

it("routes new methods and RoundDown's trunc through opaque custom backend values", async () => {
  const values = new WeakMap<NumericValue, number>();
  const wrap = (value: number): NumericValue => {
    // Test-only bridge to the private numeric brand; tokens contain no numeric representation.
    const token = Object.freeze({}) as unknown as NumericValue;
    values.set(token, value);
    return token;
  };
  const read = (value: NumericValue) => {
    const n = values.get(value);
    if (n === undefined) throw new Error("Foreign token.");
    return n;
  };
  const calls: string[] = [];
  const backend: NumericBackend = {
    ...floatBackend,
    zero: wrap(0),
    one: wrap(1),
    parseLiteral: (text) => wrap(Number(text)),
    fromNumber: (n) => (Number.isFinite(n) ? wrap(n) : undefined),
    toNumber: read,
    format: (value) => String(read(value)),
    round(value, digits) {
      calls.push(`round:${digits}`);
      return { ok: true, value: wrap(Math.round(read(value) * 10 ** digits) / 10 ** digits) };
    },
    roundUp(value, digits) {
      calls.push(`roundUp:${digits}`);
      return { ok: true, value: wrap(Math.ceil(read(value) * 10 ** digits) / 10 ** digits) };
    },
    trunc(value, digits) {
      calls.push(`trunc:${digits}`);
      return { ok: true, value: wrap(Math.trunc(read(value) * 10 ** digits) / 10 ** digits) };
    },
  };
  const engine = new Engine({ numeric: backend });
  const schema = defineSchema({ X: NumberType, P: NumberType });
  const input = engine.validateValues(schema, { X: 1.25, P: 1.9 });
  if (!input.ok) throw new Error("Invalid input.");
  for (const name of [...names, "Trunc"]) {
    expect((await engine.evaluate(`${name}(X,P)`, { schema, values: input.values })).kind).toBe(
      "value",
    );
  }
  expect(calls).toEqual(["round:1.9", "trunc:1.9", "roundUp:1.9", "trunc:1.9"]);
});

it("surfaces backend failures and rejects nonfinite precision", async () => {
  for (const backend of [floatBackend, decimalBackend]) {
    for (const precision of [NaN, Infinity, -Infinity]) {
      for (const method of ["round", "roundUp", "trunc"] as const) {
        expect(backend[method](backend.one, precision)).toEqual({ ok: false, kind: "Numeric" });
      }
    }
  }
  const failed: NumericBackend = {
    ...floatBackend,
    round: () => ({ ok: false, kind: "Numeric" }),
    roundUp: () => ({ ok: false, kind: "Numeric" }),
    trunc: () => ({ ok: false, kind: "Numeric" }),
  };
  for (const name of names) {
    expect(await new Engine({ numeric: failed }).evaluate(`${name}(1,1)`)).toMatchObject({
      kind: "value",
      value: { kind: "Error", errors: [{ kind: "Numeric" }] },
    });
    for (const nonfinite of [NaN, Infinity, -Infinity]) {
      expect(
        await new Engine({ numeric: { ...floatBackend, toNumber: () => nonfinite } }).evaluate(
          `${name}(1,1)`,
        ),
      ).toMatchObject({
        kind: "value",
        value: { kind: "Error", errors: [{ kind: "Numeric" }] },
      });
    }
  }
});
