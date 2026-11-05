import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, DecimalType } from "@powerfx-ts/core";
import {
  EvaluationBudgetExceeded,
  floatBackend,
  decimalBackend,
  truncatePrecision,
  type NumericBackend,
  type NumericValue,
} from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";

describe.each(["float", "decimal"] as const)("scalar math (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  replayRows(engine, loadRows(`scalar-math.${mode}.tsv`));

  it("recovers numeric call types without extra enclosing-call diagnostics", () => {
    for (const [formula, count] of [
      ["Abs(Abs(1E400))", 3],
      ["Int(Trunc(1E400,1E400))", 5],
      ["Trunc(Abs(missing),Int(1E400))", 5],
      ["Trunc(missing,{a:1})", 3],
    ] as const) {
      const checked = engine.check(formula);
      expect(checked.ok).toBe(false);
      expect(checked.diagnostics).toHaveLength(count);
      expect(checked.type.kind).toBe(mode === "decimal" ? "Decimal" : "Number");
    }
  });

  it("binds explicit numeric operand and Float precision coercions", () => {
    const checked = engine.check('Trunc("12.34",Decimal("1.9999999999999998"))');
    expect(checked.ok).toBe(true);
    if (checked.bound?.kind !== "Call") throw new Error("Missing call.");
    expect(checked.type.kind).toBe(mode === "decimal" ? "Decimal" : "Number");
    expect(checked.bound.args[0]).toMatchObject({
      kind: "Coerce",
      to: mode === "decimal" ? "Decimal" : "Number",
    });
    expect(checked.bound.args[1]).toMatchObject({ kind: "Coerce", to: "Number" });
    for (const name of ["Abs", "Int", "Trunc"]) {
      expect(engine.check(`${name}(Float(1))`).type.kind).toBe("Number");
      expect(engine.check(`${name}(Decimal(1))`).type.kind).toBe("Decimal");
    }
  });

  it("keeps table overloads unsupported, not invalid scalar calls", async () => {
    for (const formula of [
      "Abs([1,-2])",
      "Int([1,-2])",
      "Trunc([1,-2])",
      "Trunc([1,-2],2)",
      "Trunc(1,[1,2])",
      "Trunc([1,2],[1,2])",
    ]) {
      expect(await engine.evaluate(formula)).toMatchObject({ kind: "unsupported" });
    }
    expect(await engine.evaluate("Abs({a:1})")).toMatchObject({ kind: "invalid" });
  });

  it("freezes numeric results and combined error graphs", async () => {
    for (const formula of ["Abs(-1)", "Int(-1.5)", "Trunc(-1.5)", 'Trunc(1/0,"bad")']) {
      const result = await engine.evaluate(formula);
      if (result.kind !== "value") throw new Error("Expected result.");
      expect(Object.isFrozen(result.value)).toBe(true);
      if (result.value.kind === "Decimal") expect(Object.isFrozen(result.value.value)).toBe(true);
      if (result.value.kind === "Error") {
        expect(Object.isFrozen(result.value.errors)).toBe(true);
        for (const entry of result.value.errors) expect(Object.isFrozen(entry)).toBe(true);
      }
    }
  });

  it("checks budgets and cancellation while reaching each eager argument", async () => {
    const schema = defineSchema({ X: NumberType, P: NumberType });
    const values = engine.validateValues(schema, { X: -1.5, P: 1 });
    if (!values.ok) throw new Error("Invalid input.");
    for (const formula of ["Abs(X)", "Int(X)", "Trunc(X)", "Trunc(X,P)"]) {
      const checked = engine.check(formula, { schema });
      const steps = formula.includes(",") ? 3 : 2;
      await expect(
        new Engine({ numberMode: mode, maxSteps: steps }).evaluateChecked(checked, {
          values: values.values,
        }),
      ).resolves.toMatchObject({ kind: "value" });
      await expect(
        new Engine({ numberMode: mode, maxSteps: steps - 1 }).evaluateChecked(checked, {
          values: values.values,
        }),
      ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
      let calls = 0;
      const reason = new Error("cancel at argument");
      const signal = {
        aborted: false,
        throwIfAborted() {
          if (++calls === steps) throw reason;
        },
      };
      await expect(engine.evaluateChecked(checked, { values: values.values, signal })).rejects.toBe(
        reason,
      );
    }
    await expect(
      new Engine({ numberMode: mode, maxSteps: 4 }).evaluate("Trunc(1/0,1+2)"),
    ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
  });

  it("preserves strict nonfinite host rejection", () => {
    const schema = defineSchema({ X: NumberType });
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(engine.validateValues(schema, { X: value }).ok).toBe(false);
    }
  });

  it("never converts a Decimal operand through Number", async () => {
    const exact: NumericBackend = {
      ...decimalBackend,
      toNumber() {
        throw new Error("Decimal operand converted through Number.");
      },
    };
    const custom = new Engine({ numberMode: mode, decimal: exact });
    const schema = defineSchema({ X: DecimalType, P: NumberType });
    const values = custom.validateValues(schema, {
      X: "-1234567890123456789012345.678",
      P: 2,
    });
    if (!values.ok) throw new Error("Invalid exact input.");
    for (const [formula, expected] of [
      ["Abs(X)", "1234567890123456789012345.678"],
      ["Int(X)", "-1234567890123456789012346"],
      ["Trunc(X,P)", "-1234567890123456789012345.67"],
    ]) {
      const result = await custom.evaluate(formula!, { schema, values: values.values });
      if (result.kind !== "value" || result.value.kind !== "Decimal")
        throw new Error("Expected Decimal.");
      expect(custom.formatDecimal(result.value.value)).toBe(expected);
    }
  });
});

it("routes opaque custom values exclusively through the backend operations", async () => {
  const values = new WeakMap<NumericValue, number>();
  const wrap = (value: number): NumericValue => {
    const opaque = Object.freeze({});
    // The test double exposes no numeric representation to the engine.
    const key = opaque as unknown as NumericValue;
    values.set(key, value);
    return key;
  };
  const read = (value: NumericValue): number => {
    const n = values.get(value);
    if (n === undefined) throw new Error("Foreign numeric value.");
    return n;
  };
  const calls: string[] = [];
  const backend: NumericBackend = {
    ...floatBackend,
    zero: wrap(0),
    one: wrap(1),
    parseLiteral: (text) => wrap(Number(text)),
    fromNumber: (value) => (Number.isFinite(value) ? wrap(value) : undefined),
    parseExact: (text) => wrap(Number(text)),
    toNumber: read,
    format: (value) => String(read(value)),
    abs(value) {
      calls.push("abs");
      return { ok: true, value: wrap(Math.abs(read(value))) };
    },
    floor(value) {
      calls.push("floor");
      return { ok: true, value: wrap(Math.floor(read(value))) };
    },
    trunc(value, digits) {
      calls.push("trunc");
      return { ok: true, value: wrap(Math.trunc(read(value) * 10 ** digits) / 10 ** digits) };
    },
  };
  const engine = new Engine({ numeric: backend });
  const schema = defineSchema({ X: NumberType, P: NumberType });
  const input = engine.validateValues(schema, { X: -1.25, P: 1 });
  if (!input.ok) throw new Error("Invalid opaque input.");
  for (const [formula, expected] of [
    ["Abs(X)", "1.25"],
    ["Int(X)", "-2"],
    ["Trunc(X,P)", "-1.2"],
  ]) {
    const result = await engine.evaluate(formula!, { schema, values: input.values });
    if (result.kind !== "value" || result.value.kind !== "Number")
      throw new Error("Expected Number.");
    expect(engine.formatNumber(result.value.value)).toBe(expected);
  }
  expect(calls).toEqual(["abs", "floor", "trunc"]);
});

it("rejects nonfinite precision at the backend boundary", () => {
  for (const n of [NaN, Infinity, -Infinity]) {
    expect(floatBackend.trunc(floatBackend.one, n)).toEqual({ ok: false, kind: "Numeric" });
    expect(decimalBackend.trunc(decimalBackend.one, n)).toEqual({ ok: false, kind: "Numeric" });
  }
});

it("truncates and saturates Float precision at signed Int32 boundaries without wrapping", () => {
  for (const [digits, expected] of [
    [2147483646.9, 2147483646],
    [2147483647.9, 2147483647],
    [2147483648, 2147483647],
    [-2147483647.9, -2147483647],
    [-2147483648.9, -2147483648],
    [-2147483649, -2147483648],
    [Number.MAX_VALUE, 2147483647],
    [-Number.MAX_VALUE, -2147483648],
  ] as const) {
    expect(truncatePrecision(digits)).toBe(expected);
  }
});

it("surfaces custom-backend numeric failures without success-shaped fallback", async () => {
  const failed: NumericBackend = {
    ...floatBackend,
    abs: () => ({ ok: false, kind: "Numeric" }),
    floor: () => ({ ok: false, kind: "Numeric" }),
    trunc: () => ({ ok: false, kind: "Numeric" }),
  };
  for (const formula of ["Abs(1)", "Int(1)", "Trunc(1)"]) {
    expect(await new Engine({ numeric: failed }).evaluate(formula)).toMatchObject({
      kind: "value",
      value: { kind: "Error", errors: [{ kind: "Numeric" }] },
    });
  }
  for (const n of [NaN, Infinity, -Infinity]) {
    const engine = new Engine({ numeric: { ...floatBackend, toNumber: () => n } });
    expect(await engine.evaluate("Trunc(1,1)")).toMatchObject({
      kind: "value",
      value: { kind: "Error", errors: [{ kind: "Numeric" }] },
    });
  }
});
