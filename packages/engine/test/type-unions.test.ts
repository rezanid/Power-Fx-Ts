import { describe, expect, it } from "vitest";
import {
  defineSchema,
  NumberType,
  recordType,
  tableType,
  TextType,
  typeName,
  type FormulaType,
} from "@powerfx-ts/core";
import type { FormulaValue } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

const engine = new Engine();
const schema = defineSchema({
  Scores: tableType([{ name: "Score", type: NumberType }]),
  Customer: recordType({ Name: TextType }),
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

async function run(text: string): Promise<string> {
  const result = await engine.evaluate(text);
  if (result.kind === "invalid")
    return `invalid: ${result.diagnostics.map((d) => d.message).join("|")}`;
  if (result.kind === "unsupported")
    return `unsupported: ${result.features.map((f) => f.feature).join("|")}`;
  return show(result.value);
}

function typeOf(text: string): string {
  const r = engine.check(text, { schema });
  if (!r.ok) return `invalid: ${r.diagnostics.map((d) => d.message).join("|")}`;
  return render(r.type);
}

function render(t: FormulaType): string {
  if (t.kind === "Record")
    return `{${t.fields.map((f) => `${f.name}:${render(f.type)}`).join(",")}}`;
  if (t.kind === "Table") return `Table${render(t.row)}`;
  return typeName(t);
}

const INCOMPATIBLE = /^invalid: Incompatible type\. The item/;
const MISMATCH = /^invalid: Argument type mismatch/;

// Expected values for the cases below were cross-checked against the pinned C# RecalcEngine
// (PowerFxV1, en-US); see ADR 0008.
describe("If with record/table results", () => {
  it("identical types are unchanged", async () => {
    expect(typeOf("If(true, {a: 1}, {a: 2})")).toBe("{a:Number}");
    expect(await run("If(true, {a: 1}, {a: 2})")).toBe("{a:1}");
  });
  it("disjoint fields union and missing fields are Blank, in ordinal field order", async () => {
    expect(typeOf("If(true, {b: 1}, {a: 2})")).toBe("{a:Number,b:Number}");
    expect(await run("If(true, {a: 1}, {b: 2})")).toBe("{a:1,b:Blank()}");
    expect(await run("If(false, {a: 1}, {a: 2, b: 3})")).toBe("{a:2,b:3}");
    expect(await run("If(true, Table({a: 1}), Table({b: 2}))")).toBe("Table({a:1,b:Blank()})");
  });
  it("the left scalar type wins for same-name fields", async () => {
    expect(typeOf('If(true, {a: 1}, {a: "1"})')).toBe("{a:Number}");
    expect(await run('If(false, {a: 1}, {a: "1"})')).toBe("{a:1}");
    expect(await run('If(false, {a: "x"}, {a: 1})')).toBe('{a:"1"}');
    expect(await run("If(false, {a: 1}, {a: true, b: 2})")).toBe("{a:1,b:2}");
  });
  it("a coercion failure becomes a field error, not a row error", async () => {
    expect(await run('If(false, Table({a: 1}), Table({a: "x", b: 1}))')).toBe(
      "Table({a:Error:InvalidArgument,b:1})",
    );
  });
  it("Blank unions with a typed aggregate", async () => {
    expect(typeOf("If(true, {a: 1}, Blank())")).toBe("{a:Number}");
    expect(await run("If(true, {a: 1}, Blank())")).toBe("{a:1}");
    expect(await run("If(false, Blank(), {a: 1})")).toBe("{a:1}");
    expect(await run("If(true, Blank(), {a: 1})")).toBe("Blank()");
  });
  it("unions nested records field by field", async () => {
    expect(await run("If(false, {a: {b: 1}}, {a: {c: true}})")).toBe("{a:{b:Blank(),c:true}}");
  });
  it("rejects incompatible aggregate shapes", () => {
    expect(typeOf("If(false, {a: 1}, {a: {b: 1}})")).toMatch(MISMATCH);
    expect(typeOf("If(false, {a: {b: 1}}, {a: 1})")).toMatch(MISMATCH);
    expect(typeOf("If(true, {a: 1}, 1/0)")).toMatch(MISMATCH);
    expect(typeOf("If(false, [1], {Value: 1})")).toMatch(MISMATCH);
    expect(typeOf('If(true, {a: 1}, "x")')).toMatch(MISMATCH);
  });
  it("stays lazy and propagates a condition error", async () => {
    expect(await run("If(false, {a: 1, b: 1/0}, {a: 2, b: 3})")).toBe("{a:2,b:3}");
    expect(await run("If(1/0 > 1, {a: 1}, {a: 2, b: 3})")).toBe("Error:Div0");
  });
  it("keeps field errors uncoerced and evaluates fields in source order", async () => {
    expect(await run('If(true, {a: 1, b: 1/0}, {b: "s"})')).toBe("{a:1,b:Error:Div0}");
  });
});

describe("Table(...) and table literals", () => {
  it("coerce same-name scalar fields to the first row's type", async () => {
    expect(typeOf("Table({a: 1}, {a: true})")).toBe("Table{a:Number}");
    expect(await run("Table({a: 0}, {a: true})")).toBe("Table({a:0},{a:1})");
    expect(await run('Table({a: "x"}, {a: true})')).toBe('Table({a:"x"},{a:"true"})');
    expect(await run('Table({a: true}, {a: "true"}, {a: "x"})')).toBe(
      "Table({a:true},{a:true},{a:Error:InvalidArgument})",
    );
    expect(await run("[1, true]")).toBe("Table({Value:1},{Value:1})");
    expect(await run('["a", 1]')).toBe('Table({Value:"a"},{Value:"1"})');
  });
  it("coerces whole tables argument by argument", async () => {
    expect(await run('Table([42], ["everything"])')).toBe(
      "Table({Value:42},{Value:Error:InvalidArgument})",
    );
    expect(await run('Table(["everything"], [42])')).toBe(
      'Table({Value:"everything"},{Value:"42"})',
    );
  });
  it("fills missing fields with Blank in union field order", async () => {
    expect(await run("[{b: 1}, {a: 2}]")).toBe("Table({a:Blank(),b:1},{a:2,b:Blank()})");
  });
  it("wraps a Blank scalar item as a Blank Value; Blank stays a row beside records", async () => {
    expect(await run("[1, Blank()]")).toBe("Table({Value:1},{Value:Blank()})");
    expect(await run("[{a: 1}, Blank(), {a: true}]")).toBe("Table({a:1},Blank(),{a:1})");
    expect(await run("[Blank(), 1]")).toBe("Table({Value:Blank()},{Value:1})");
  });
  it("unions nested records and tables", async () => {
    expect(await run("Table({a: {x: 1}}, {a: Blank()}, {a: {y: 2}})")).toBe(
      "Table({a:{x:1,y:Blank()}},{a:Blank()},{a:{x:Blank(),y:2}})",
    );
    expect(await run('Table({a: Table({x: 1})}, {a: Table({x: "1"})})')).toBe(
      "Table({a:Table({x:1})},{a:Table({x:1})})",
    );
    expect(await run("[[1], Blank()]")).toBe("Table({Value:Table({Value:1})},{Value:Blank()})");
  });
  it("rejects incompatible field and item types with upstream diagnostics", async () => {
    expect(await run("Table({a: Table({x: 1})}, {a: {x: 1}})")).toMatch(
      /^invalid: The function 'Table' has some invalid arguments\.\|Incompatible type/,
    );
    expect(await run("[{a: 1}, {a: {b: 1}}]")).toMatch(INCOMPATIBLE);
    expect(await run("[{a: 1}, 1]")).toMatch(INCOMPATIBLE);
  });
  it("keeps all-Blank tables unsupported", async () => {
    expect(await run("[Blank()]")).toBe("unsupported: Table of only Blank values");
  });
});

describe("integration", () => {
  it("First, Filter and LookUp work over unioned tables", async () => {
    expect(await run("First(Table({a: 1}, {b: 2})).b")).toBe("Blank()");
    expect(await run("Filter(Table({a: 1}, {b: 2}), IsBlank(a))")).toBe("Table({a:Blank(),b:2})");
    expect(await run('LookUp(Table({a: 1}, {a: "x"}), a > 5, a)')).toBe("Error:InvalidArgument"); // a field error makes the predicate an error row
    expect(await run("LookUp([{a: 1}, {a: true}], a > 0 And a < 2 , a)")).toBe("1");
    expect(await run("First(If(true, [1], [2, 3])).Value")).toBe("1");
  });
  it("results are deeply immutable", async () => {
    const r = await engine.evaluate("If(true, {a: {b: 1}}, {a: {c: 2}, d: 4})");
    if (r.kind !== "value" || r.value.kind !== "Record") throw new Error("expected record");
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value.fields)).toBe(true);
    expect(Object.isFrozen(r.value.fields[0]!.value)).toBe(true);
    const t = await engine.evaluate("Table({a: 1}, {b: 2})");
    if (t.kind !== "value" || t.value.kind !== "Table") throw new Error("expected table");
    expect(Object.isFrozen(t.value.rows)).toBe(true);
    expect(Object.isFrozen(t.value.rows[0])).toBe(true);
  });
  it("charges one step per row when conforming", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ Score: i }));
    const formula = "If(true, Scores, Table({Score: 1}, {Score: 2, X: 3}))";
    const checked = engine.check(formula, { schema });
    const v = engine.validateValues(schema, { Scores: rows, Customer: null });
    if (!v.ok) throw new Error("invalid input");
    const go = (maxSteps: number) =>
      new Engine({ maxSteps }).evaluateChecked(checked, { values: v.values });
    await expect(go(500)).rejects.toThrow(/budget/);
    expect((await go(10000)).kind).toBe("value");
  });
});
