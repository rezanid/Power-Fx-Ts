import { describe, expect, it } from "vitest";
import {
  BooleanType,
  defineSchema,
  NumberType,
  recordType,
  tableType,
  TextType,
} from "@powerfx-ts/core";
import type { FormulaValue } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

const engine = new Engine();
const rowType = [{ name: "Score", type: NumberType }];
const schema = defineSchema({
  Items: tableType([
    { name: "Name", type: TextType },
    { name: "Score", type: NumberType },
  ]),
  Customer: recordType({ RiskScore: NumberType }),
  Flag: BooleanType,
  Numbers: tableType([{ name: "Value", type: NumberType }]),
  Scores: tableType(rowType),
});

function show(v: FormulaValue): string {
  switch (v.kind) {
    case "Blank":
      return "Blank()";
    case "Text":
      return JSON.stringify(v.value);
    case "Boolean":
      return String(v.value);
    case "Number":
      return engine.formatNumber(v.value);
    case "Record":
      return `{${v.fields.map((f) => `${f.name}:${show(f.value)}`).join(",")}}`;
    case "Table":
      return `Table(${v.rows.map(show).join(",")})`;
    case "Error":
      return `Error:${v.errors[0]?.kind}`;
  }
}

async function run(text: string, input: unknown = all()): Promise<string> {
  const r = engine.validateValues(schema, input);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  const options = { schema, values: r.values };
  const result = await engine.evaluate(text, options);
  if (result.kind === "invalid")
    return `invalid: ${result.diagnostics.map((d) => d.message).join("|")}`;
  if (result.kind === "unsupported")
    return `unsupported: ${result.features.map((f) => f.feature).join("|")}`;
  return show(result.value);
}

const all = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  Items: [],
  Customer: null,
  Flag: true,
  Numbers: [],
  Scores: [],
  ...extra,
});

const NEED_NAME = (n: string): string => `invalid: Name isn't valid. '${n}' isn't recognized.`;

const E = "Filter([0], 1/Value > 0)"; // one-row table whose only row is a Div0 error

describe("demo formulas", () => {
  it("First(...).Score", async () => {
    expect(await run("First(Filter(Table({Score:90}, {Score:50}), Score > 80)).Score")).toBe("90");
  });
  it("CountRows(...)", async () => {
    expect(await run("CountRows(Filter(Table({Score:90}, {Score:50}), Score > 80))")).toBe("1");
  });
  it("LookUp with As and a result formula", async () => {
    expect(
      await run("LookUp(Table({Score:90}, {Score:50}) As item, item.Score > 80, item.Score)"),
    ).toBe("90");
  });
  it("types results from the shared binder", () => {
    const t = (f: string) => engine.check(f, { schema }).type;
    expect(t("First(Scores)")).toEqual(recordType({ Score: NumberType }));
    expect(t("CountRows(Scores)")).toEqual(NumberType);
    expect(t("LookUp(Scores, true)")).toEqual(recordType({ Score: NumberType }));
    expect(t("LookUp(Items, true, Name)")).toEqual(TextType);
  });
});

describe("First", () => {
  it("is Blank for empty and Blank sources, and propagates error sources", async () => {
    expect(await run("First(Scores)")).toBe("Blank()");
    expect(await run("First(Blank())")).toBe("Blank()");
    expect(await run("First(Filter([1,2,3], Value = 4)).Value")).toBe("Blank()");
    expect(await run("First(If(1/0 < 2, [1]))")).toBe("Error:Div0");
  });
  it("returns an error row, a Blank row and Blank for a missing field", async () => {
    expect(await run(`First(${E})`)).toBe("Error:Div0");
    expect(await run(`First(${E}).Value`)).toBe("Error:Div0");
    expect(await run("First(Table(Blank(), {a:1})).a")).toBe("Blank()");
    expect(await run("First(Table({a:1,b:2},{c:3})).c")).toBe("Blank()");
  });
  it("supports nested field access", async () => {
    expect(await run("First(Table({a:{ac:5}})).a.ac")).toBe("5");
  });
  it("rejects bad arguments", async () => {
    expect(await run("First({a:1})")).toBe(
      "invalid: The function 'First' has some invalid arguments.|Invalid argument type (Record). Expecting a Table value instead.",
    );
    expect(await run("First(Scores, Scores)")).toMatch(/^invalid: Invalid number of arguments/);
    expect(await run("First()")).toMatch(/^invalid: Invalid number of arguments/);
  });
});

describe("CountRows", () => {
  it("counts rows, Blank rows and rows with field errors", async () => {
    expect(await run("CountRows(Scores)")).toBe("0");
    expect(await run("CountRows(Table({a:1}, Blank(), {a:3}))")).toBe("3");
    expect(await run("CountRows(Table({a:1/0},{a:1/0}))")).toBe("2");
  });
  it("is 0 for Blank, and propagates errors", async () => {
    expect(await run("CountRows(Blank())")).toBe("0");
    expect(await run("CountRows(If(1/0 < 2, [1]))")).toBe("Error:Div0");
  });
  it("returns the error of any error row", async () => {
    expect(await run("CountRows(Filter([-2,-1,0,1,2], 1/Value < 3))")).toBe("Error:Div0");
    expect(await run(`CountRows(${E})`)).toBe("Error:Div0");
  });
});

describe("LookUp", () => {
  it("returns the first match, or Blank", async () => {
    expect(await run("LookUp([1,2,3,4], Value > 2)")).toBe("{Value:3}");
    expect(await run("LookUp([1,2,3,4], Value > 9)")).toBe("Blank()");
    expect(await run("LookUp(Scores, true)")).toBe("Blank()");
    expect(await run("LookUp([1,2,3,4], Blank())")).toBe("Blank()");
    expect(await run("LookUp([1,2,3,4], Value > 9, Value)")).toBe("Blank()");
  });
  it("evaluates the projection in the matched row's scope", async () => {
    expect(await run("LookUp([1,2,3,4], Value > 2, Value * 10)")).toBe("30");
    expect(await run("LookUp(Table({a:1},Blank()), IsBlank(ThisRecord), a)")).toBe("Blank()");
    // Selected Blank row: constants run (reference: 42, 7); row reads are a reference NRE, Blank here.
    expect(await run("LookUp(Table(Blank(),{a:1}), true, 42)")).toBe("42");
    expect(await run("LookUp(Table(Blank(),{a:1}), IsBlank(ThisRecord), 7)")).toBe("7");
    expect(await run("LookUp(Table(Blank(),{a:1}), true, a)")).toBe("Blank()");
    expect(await run("LookUp(Table(Blank(),{a:1}) As r, true, r.a)")).toBe("Blank()");
    expect(await run("LookUp(Table(Blank(),{a:1}), true, ThisRecord)")).toBe("Blank()");
    expect(await run("LookUp([1,2,3] As X, X.Value > 1, X.Value + X.Value)")).toBe("4");
  });
  it("propagates Blank and error sources", async () => {
    // V1 rules reject an untyped Blank() as a scope source (corpus: LookUp(Blank(), Blank())).
    expect(await run("LookUp(Blank(), true)")).toMatch(/^invalid: Invalid argument type\./);
    expect(await run("LookUp(If(1/0<2,[1,2]), true)")).toBe("Error:Div0");
  });
  it("uses an error row as the match when it is first", async () => {
    expect(await run("LookUp([0,3,4], 1/Value >= 0)")).toBe("Error:Div0");
    expect(await run("LookUp([1,0,3,4], 1/Value >= 0)")).toBe("{Value:1}");
    expect(await run("LookUp([0,3,4], Value = 0, 1/Value)")).toBe("Error:Div0");
    // Reference-verified: the projection still runs for a selected error row.
    expect(await run(`LookUp(${E}, true, 42)`)).toBe("42");
    expect(await run("With({k: 5}, LookUp(" + E + ", true, k))")).toBe("5");
    expect(await run(`LookUp(${E}, true, 1/0)`)).toBe("Error:Div0");
    // Reference defect (NullReferenceException); ours: the scope value is the error itself.
    expect(await run(`LookUp(${E}, true, Value)`)).toBe("Error:Div0");
    expect(await run(`LookUp(${E} As r, true, r.Value)`)).toBe("Error:Div0");
    expect(await run(`LookUp(${E}, true, ThisRecord.Value)`)).toBe("Error:Div0");
    expect(await run(`LookUp(${E}, true)`)).toBe("Error:Div0");
  });
  it("shadows outer scopes and nests", async () => {
    expect(
      await run("LookUp([1,2,3] As a, a.Value > 1, LookUp([10,20] As a, a.Value > 10, a.Value))"),
    ).toBe("20");
    expect(await run("LookUp([1,2,3], Value = LookUp([5,2], Value < 3).Value)")).toBe("{Value:2}");
    expect(await run("With({k: 2}, LookUp([1,2,3], Value = k, Value + k))")).toBe("4");
  });
  it("requires As to hide implicit fields, in predicate and projection", async () => {
    expect(await run("LookUp([1,2,3] As X, Value > 2)")).toBe(NEED_NAME("Value"));
    expect(await run("LookUp([1,2,3] As X, X.Value > 2, Value)")).toBe(NEED_NAME("Value"));
  });
  it("does not scope arguments past the third", async () => {
    expect(await run("LookUp([1,2,3], Value > 1, Value, Value)")).toMatch(/^invalid:/);
  });
  it("rejects bad arguments", async () => {
    expect(await run("LookUp([1,2,3])")).toMatch(/^invalid: Invalid number of arguments/);
    expect(await run('LookUp([1,2,3], "string")')).toMatch(/^invalid:/);
    expect(await run("LookUp(true, true)")).toMatch(/^invalid:/);
    expect(await run("LookUp(Blank(), Blank())")).toMatch(/^invalid:/);
  });
  it("does not short-circuit: every row is visited and charged", async () => {
    // The first row matches, yet a later row's predicate is still evaluated.
    const rows = Array.from({ length: 1000 }, (_, i) => ({ Score: i }));
    const checked = engine.check("LookUp(Scores, true)", { schema });
    const v = engine.validateValues(schema, all({ Scores: rows }));
    if (!v.ok) throw new Error("invalid input");
    const go = (maxSteps: number) =>
      new Engine({ maxSteps }).evaluateChecked(checked, { values: v.values });
    await expect(go(1500)).rejects.toThrow(/budget/);
    expect((await go(5000)).kind).toBe("value");
    let calls = 0;
    const signal = {
      aborted: false,
      throwIfAborted() {
        if (++calls > 50) throw new Error("cancelled");
      },
    };
    await expect(
      engine.evaluate("LookUp(Scores, true)", { schema, values: v.values, signal }),
    ).rejects.toThrow("cancelled");
  });
  it("a later row's error does not replace the first match", async () => {
    expect(await run("LookUp([1,0], Value = 1 Or 1/Value > 0)")).toBe("{Value:1}");
  });
});

describe("T.Field projection", () => {
  it("is invalid under PowerFxV1 rules, with the deprecation diagnostic", async () => {
    expect(await run("Scores.Score")).toBe(
      "invalid: Deprecated use of '.'. Please use the 'ShowColumns' function instead.",
    );
    expect(await run("Filter(Scores, true).Score")).toMatch(/^invalid: Deprecated use of '.'/);
  });
  it("does not conceal a missing field on a record", async () => {
    expect(await run("First(Scores).Nope")).toMatch(/^invalid:/);
  });
});

describe("immutability and schema interaction", () => {
  it("returns frozen rows and fields", async () => {
    const v = engine.validateValues(schema, all({ Scores: [{ Score: 1 }] }));
    if (!v.ok) throw new Error("invalid input");
    const r = await engine.evaluate("First(Scores)", { schema, values: v.values });
    if (r.kind !== "value" || r.value.kind !== "Record") throw new Error("expected record");
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value.fields[0]!.value)).toBe(true);
  });
  it("works over schema tables and Customer records", async () => {
    expect(
      await run("LookUp(Items, Score > Customer.RiskScore, Name)", {
        ...all({
          Items: [
            { Name: "a", Score: 5 },
            { Name: "b", Score: 99 },
          ],
        }),
        Customer: { RiskScore: 80 },
      }),
    ).toBe('"b"');
  });
});
