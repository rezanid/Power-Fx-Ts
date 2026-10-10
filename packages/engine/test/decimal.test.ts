import { describe, expect, it } from "vitest";
import { defineSchema, DecimalType, NumberType, tableType } from "@powerfx-ts/core";
import type { FormulaType } from "@powerfx-ts/core";
import type { FormulaValue } from "@powerfx-ts/interpreter";
import { decimalBackend } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

const dec = new Engine({ numberMode: "decimal" });
const flt = new Engine();

function show(e: Engine, v: FormulaValue): string {
  switch (v.kind) {
    case "Blank":
      return "Blank()";
    case "Text":
      return JSON.stringify(v.value);
    case "Boolean":
      return String(v.value);
    case "Number":
      return `F${e.formatNumber(v.value)}`;
    case "Decimal":
      return `D${e.formatDecimal(v.value)}`;
    case "Record":
      return `{${v.fields.map((f) => `${f.name}:${show(e, f.value)}`).join(",")}}`;
    case "Table":
      return `Table(${v.rows.map((r) => show(e, r)).join(",")})`;
    case "Error":
      return `Error:${v.errors[0]?.kind}`;
  }
}

async function run(e: Engine, text: string): Promise<string> {
  const r = await e.evaluate(text);
  if (r.kind === "invalid") return `invalid: ${r.diagnostics.map((d) => d.message).join("|")}`;
  if (r.kind === "unsupported") return `unsupported: ${r.features.map((f) => f.feature).join("|")}`;
  return show(e, r.value);
}

const d = (t: string) => run(dec, t);
const f = (t: string) => run(flt, t);

function typeOf(e: Engine, text: string, schema = defineSchema({})): string {
  const r = e.check(text, { schema });
  if (!r.ok) return "invalid";
  const render = (t: FormulaType): string =>
    t.kind === "Table" ? `Table<${render(t.row)}>` : t.kind;
  return render(r.type);
}

// Expected values below were produced by the pinned C# reference (Features.PowerFxV1), not by this code.
describe("decimal literals, range and formatting", () => {
  it("types literals by number mode", () => {
    expect(typeOf(dec, "1.5")).toBe("Decimal");
    expect(typeOf(flt, "1.5")).toBe("Number");
    expect(typeOf(dec, "Float(1.5)")).toBe("Number");
  });
  it("rounds half-even to 28 digits and drops trailing zeros", async () => {
    expect(await d("0.5e-28")).toBe("D0");
    expect(await d("1.5e-28")).toBe("D0.0000000000000000000000000002");
    expect(await d("7.92281625142643375935439503355")).toBe("D7.922816251426433759354395034");
    expect(await d("1.10")).toBe("D1.1");
    expect(await d("5%")).toBe("D0.05");
  });
  it("rejects out-of-range literals as diagnostics in decimal mode only", async () => {
    expect(await d("79228162514264337593543950335")).toBe("D79228162514264337593543950335");
    expect(await d("79228162514264337593543950335.5")).toMatch(/^invalid: .*too large/);
    expect(await d("1E100")).toMatch(/^invalid: .*too large/);
    expect(await f("1E100")).toBe("F1E+100");
  });
});

describe("decimal arithmetic", () => {
  it("is exact where floats are not", async () => {
    expect(await d("0.1+0.2")).toBe("D0.3");
    expect(await f("0.1+0.2")).toBe("F0.30000000000000004");
  });
  it("quantizes division to 28 digits", async () => {
    expect(await d("1/3")).toBe("D0.3333333333333333333333333333");
    expect(await d("1/3*3")).toBe("D0.9999999999999999999999999999");
    expect(await d("79228162514264337593543950335/10")).toBe("D7922816251426433759354395033.5");
  });
  it("reports overflow and division by zero as errors", async () => {
    expect(await d("79228162514264337593543950335*1.1")).toBe("Error:Numeric");
    expect(await d("79228162514264337593543950335+1")).toBe("Error:Numeric");
    expect(await d("79228162514264337593543950335/0.1")).toBe("Error:Numeric");
    expect(await d("1/0")).toBe("Error:Div0");
  });
  it("always computes ^ in floating point", async () => {
    expect(await d("2^3")).toBe("F8");
    expect(await d("0^-1")).toBe("Error:Div0");
    expect(await d("(-8)^(1/3)")).toBe("Error:Numeric");
  });
  it("coerces Text, Boolean and Blank to the operation's numeric kind", async () => {
    expect(await d('"1"+"2"')).toBe("D3");
    expect(await d("Blank()+Blank()")).toBe("D0");
    expect(await d("-1.5")).toBe("D-1.5");
    expect(await d("-Float(1.5)")).toBe("F-1.5");
  });
  it("types mixed Decimal/Float arithmetic as Float", async () => {
    expect(typeOf(dec, "1.5+Float(1)")).toBe("Number");
    expect(typeOf(dec, "1.5+1")).toBe("Decimal");
    expect(await d("1.5+Float(1)")).toBe("F2.5");
  });
  it("types CountRows as Decimal in decimal mode only", () => {
    const sch = defineSchema({ T: tableType([{ name: "A", type: DecimalType }]) });
    expect(typeOf(dec, "CountRows(T)", sch)).toBe("Decimal");
    expect(typeOf(flt, "CountRows(T)", sch)).toBe("Number");
  });
});

describe("comparison", () => {
  it("compares exactly within Decimal", async () => {
    expect(await d("0.1+0.2=0.3")).toBe("true");
    expect(await d("1.0000000000000000000000001>1")).toBe("true");
  });
  it("converts Decimal to float when either side is Float", async () => {
    expect(await d("Float(1)=1.0000000000000000000000001")).toBe("true");
  });
  it("keeps Blank and incompatible-type rules", async () => {
    expect(await d("Blank()=0")).toBe("false");
    expect(await d('"1.5"=1.5')).toMatch(/^invalid: .*Incompatible types/);
    expect(await d("true=1")).toMatch(/^invalid: .*Incompatible types/);
  });
});

describe("Decimal() and Float()", () => {
  it("converts Float to Decimal keeping 15 significant digits", async () => {
    expect(await d("Decimal(Float(0.1+0.2))")).toBe("D0.3");
    expect(await d('Decimal(Float("1e28"))')).toBe("D10000000000000000000000000000");
    expect(await d('Decimal(Float("1e29"))')).toBe("Error:InvalidArgument");
    expect(await d('Decimal(Float("1e-29"))')).toBe("D0");
  });
  it("parses text and keeps Blank", async () => {
    expect(await d('Decimal("1e5")')).toBe("D100000");
    expect(await d('Decimal(" 3 ")')).toBe("D3");
    expect(await d('Decimal("1.2.3")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1e100")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("")')).toBe("Blank()");
    expect(await d("Decimal(Blank())")).toBe("Blank()");
    expect(await d('Decimal("  ")')).toBe("Error:InvalidArgument");
    expect(await d("Decimal(true)")).toBe("D1");
  });
  it("converts Decimal to the nearest double", async () => {
    expect(await d("Float(1.5)")).toBe("F1.5");
    expect(await d('Float("1e400")')).toBe("Error:InvalidArgument");
  });
  it("reports the locale form and invalid arities explicitly", async () => {
    expect(await d("Decimal(1,2)")).toMatch(/^unsupported/);
    expect(await d("Decimal()")).toMatch(/^invalid/);
    expect(await d("Decimal({a:1})")).toMatch(/^invalid/);
  });
});

describe("unions and projections (left operand wins)", () => {
  it("keeps the first branch's numeric kind", async () => {
    expect(await d("If(true,1.5,Float(1))")).toBe("D1.5");
    expect(await d("If(true,Float(1),1.5)")).toBe("F1");
    expect(await d('If(true,"1",1.5)')).toBe('"1"');
    expect(typeOf(dec, "If(true,1.5,Float(1))")).toBe("Decimal");
  });
  it("coerces table literal rows by the first row's field type", async () => {
    expect(await d("Table({a:1.5},{a:Float(2)})")).toBe("Table({a:D1.5},{a:D2})");
    expect(await d("Table({a:Float(2)},{a:1.5})")).toBe("Table({a:F2},{a:F1.5})");
  });
  it("works through Filter, First and LookUp", async () => {
    expect(await d("First(Filter(Table({s:90.5},{s:50}), s > 80)).s")).toBe("D90.5");
    expect(await d("CountRows(Filter(Table({s:90},{s:50}), s > 80))")).toBe("D1");
    expect(await d("LookUp(Table({s:90},{s:50}) As i, i.s > 80, i.s * 2)")).toBe("D180");
  });
  it("evaluates If lazily", async () => {
    expect(await d("If(true, 1.5, 1/0)")).toBe("D1.5");
  });
});

describe("host input", () => {
  const sch = defineSchema({ Amount: DecimalType, Ratio: NumberType });
  const check = () => dec.check("Amount * 2", { schema: sch });
  const ok = (input: Record<string, unknown>) => {
    const r = dec.validateValues(sch, input);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.values;
  };

  it("accepts decimal strings, bigint and safe integers without losing digits", async () => {
    const checked = check();
    if (!checked.ok) throw new Error("check failed");
    const go = async (amount: unknown) => {
      const r = await dec.evaluateChecked(checked, { values: ok({ Amount: amount, Ratio: 1 }) });
      return r.kind === "value" ? show(dec, r.value) : r.kind;
    };
    expect(await go("0.1234567890123456789012345")).toBe("D0.246913578024691357802469");
    expect(await go(12345678901234567890n)).toBe("D24691357802469135780");
    expect(await go(21)).toBe("D42");
  });
  it("rejects imprecise numbers and over-precise or out-of-range strings", () => {
    for (const bad of [
      0.1,
      1e21,
      NaN,
      "1.00000000000000000000000000001",
      "1e30",
      "abc",
      "",
      true,
    ]) {
      const r = dec.validateValues(sch, { Amount: bad, Ratio: 1 });
      expect(r.ok, String(bad)).toBe(false);
    }
  });
  it("leaves Float fields as finite JS numbers", () => {
    expect(dec.validateValues(sch, { Amount: 1, Ratio: 0.1 }).ok).toBe(true);
    expect(dec.validateValues(sch, { Amount: 1, Ratio: "0.1" }).ok).toBe(false);
  });
  it("keeps the schema fixed while values vary", async () => {
    const checked = check();
    if (!checked.ok) throw new Error("check failed");
    const a = await dec.evaluateChecked(checked, { values: ok({ Amount: "1.5", Ratio: 0 }) });
    const b = await dec.evaluateChecked(checked, { values: ok({ Amount: "2.5", Ratio: 0 }) });
    expect([a, b].map((r) => (r.kind === "value" ? show(dec, r.value) : r.kind))).toEqual([
      "D3",
      "D5",
    ]);
  });
  it("freezes Decimal values, including inside records", async () => {
    const r = await dec.evaluate("{a:1.5}");
    if (r.kind !== "value" || r.value.kind !== "Record") throw new Error("expected record");
    const field = r.value.fields[0]!.value;
    expect(Object.isFrozen(field)).toBe(true);
    expect(() => {
      (field as { value: unknown }).value = 1;
    }).toThrow();
  });
});

describe("backend identity and mode", () => {
  it("rejects checked results and values from another number mode", async () => {
    const sch = defineSchema({ X: NumberType });
    const checked = dec.check("X + 1", { schema: sch });
    if (!checked.ok) throw new Error("check failed");
    const values = flt.validateValues(sch, { X: 1 });
    if (!values.ok) throw new Error("bad values");
    await expect(flt.evaluateChecked(checked, { values: values.values })).rejects.toThrow(
      /numeric configuration/,
    );
    const own = dec.validateValues(sch, { X: 1 });
    if (!own.ok) throw new Error("bad values");
    await expect(flt.evaluateChecked(checked, { values: own.values })).rejects.toThrow(
      /numeric configuration/,
    );
  });
  it("rejects values validated by an engine with a different decimal backend instance", () => {
    const sch = defineSchema({ X: DecimalType });
    const other = new Engine({ numberMode: "decimal", decimal: { ...decimalBackend } });
    const v = other.validateValues(sch, { X: 1 });
    if (!v.ok) throw new Error("bad values");
    return expect(dec.evaluate("X", { schema: sch, values: v.values })).rejects.toThrow(
      /numeric configuration/,
    );
  });
});

describe("budgets and cancellation", () => {
  it("applies the evaluation budget to decimal expressions", async () => {
    const tight = new Engine({ numberMode: "decimal", maxSteps: 2 });
    await expect(tight.evaluate("1.5+2.5+3.5+4.5")).rejects.toThrow(/budget/);
    expect(
      (await new Engine({ numberMode: "decimal", maxSteps: 50 }).evaluate("1.5+2.5")).kind,
    ).toBe("value");
  });
  it("honours cancellation", async () => {
    const signal = { aborted: true, reason: new Error("stop") };
    await expect(dec.evaluate("1.5+2.5", { signal })).rejects.toThrow();
  });
});
