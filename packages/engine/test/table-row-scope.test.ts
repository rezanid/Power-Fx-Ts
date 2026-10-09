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

describe("demo formula", () => {
  it("keeps only the rows whose predicate is true", async () => {
    expect(await run("Filter(Table({Score: 90}, {Score: 50}) As item, item.Score > 80)")).toBe(
      "Table({Score:90})",
    );
  });

  it("is typed as a table with the source row type", () => {
    const checked = engine.check(
      "Filter(Table({Score: 90}, {Score: 50}) As item, item.Score > 80)",
    );
    expect(checked.ok).toBe(true);
    expect(checked.type).toEqual(tableType(rowType));
  });
});

describe("table construction", () => {
  it("wraps scalar literal items in a Value column (PowerFxV1 TableSyntaxDoesntWrapRecords)", async () => {
    expect(await run("[1, 2, 3]")).toBe("Table({Value:1},{Value:2},{Value:3})");
    expect(await run('["a", "b"]')).toBe('Table({Value:"a"},{Value:"b"})');
    expect(await run("[Blank(), 1]")).toBe("Table({Value:Blank()},{Value:1})");
  });

  it("uses record literal items as rows without wrapping them", async () => {
    expect(await run("[{a: 1}, {a: 2}]")).toBe("Table({a:1},{a:2})");
    expect(await run("[Blank(), {a: 1}]")).toBe("Table(Blank(),{a:1})");
  });

  it("builds empty tables", async () => {
    expect(await run("Table()")).toBe("Table()");
    expect(await run("[]")).toBe("Table()");
    expect(await run("Table([])")).toBe("Table()");
    expect(await run("Table(Table(Table()))")).toBe("Table()");
  });

  it("unions disjoint record fields in the type and fills missing fields with Blank", async () => {
    expect(await run("Table({a: 0}, {b: true})")).toBe("Table({a:0,b:Blank()},{a:Blank(),b:true})");
    const checked = engine.check("Table({b: true}, {a: 0})");
    expect(checked.type).toEqual(
      tableType([
        { name: "a", type: NumberType },
        { name: "b", type: BooleanType },
      ]),
    );
  });

  it("splices table arguments and treats an untyped Blank as a Blank row", async () => {
    expect(await run("Table([{a: 1}], {a: 2}, [{a: 3}])")).toBe("Table({a:1},{a:2},{a:3})");
    expect(await run("Table(Blank(), Blank())")).toBe("Table(Blank(),Blank())");
    expect(await run("Table([1, 2], Blank(), [4])")).toBe(
      "Table({Value:1},{Value:2},Blank(),{Value:4})",
    );
  });

  it("makes an error record argument an error row and an error table argument the result", async () => {
    expect(await run("Table({a: 1}, If(1/0 < 2, {a: 2}), {a: 3})")).toBe(
      "Table({a:1},Error:Div0,{a:3})",
    );
    expect(await run("Table([{a: 1}], If(1/0 < 2, [{a: 2}]), {a: 3})")).toBe("Error:Div0");
  });

  it("skips a typed Blank table argument and keeps a Blank record row", async () => {
    expect(await run("Table([{a: 1}], If(1 < 0, [{a: 2}]))")).toBe("Table({a:1})");
    expect(await run("[{a: 1}, If(1 < 0, {a: 2})]")).toBe("Table({a:1},Blank())");
  });

  it("keeps errors inside fields as field values", async () => {
    expect(await run("[1, 2/0]")).toBe("Table({Value:1},{Value:Error:Div0})");
  });

  it("keeps nested records and tables as field values", async () => {
    expect(await run("Table({a: {b: 1}}, {c: 2})")).toBe(
      "Table({a:{b:1},c:Blank()},{a:Blank(),c:2})",
    );
  });

  it("rejects non record/table Table() arguments and scalar rows next to records", async () => {
    expect(await run("Table(1)")).toBe(
      "invalid: The function 'Table' has some invalid arguments.|Only record or table values can be used in this context.",
    );
    expect(await run("[{a: 1}, 1]")).toMatch(/^invalid: Incompatible type\. The item/);
  });

  it("reports upstream coercing unions and constructs it cannot model as unsupported", async () => {
    expect(await run("Table({a: 0}, {a: true})")).toBe(
      "unsupported: Table argument field type coercion",
    );
    expect(await run("[1, true]")).toBe("unsupported: Table element type coercion");
    expect(await run("[[1], [2]]")).toBe("unsupported: Table nested in a table literal");
    expect(await run("[Blank()]")).toBe("unsupported: Table of only Blank values");
    expect(await run("[1, 2].Value")).toBe("unsupported: Column projection on a table");
  });
});

describe("Filter", () => {
  it("resolves fields implicitly and through ThisRecord", async () => {
    expect(await run("Filter([1, 2, 3], Value >= 2)")).toBe("Table({Value:2},{Value:3})");
    expect(await run("Filter([1, 2, 3], ThisRecord.Value >= 2)")).toBe(
      "Table({Value:2},{Value:3})",
    );
    expect(await run("Filter([1, 2, 3] As X, X.Value > 2)")).toBe("Table({Value:3})");
  });

  it("returns an empty table for no matches, an empty source, or a Blank predicate", async () => {
    expect(await run("Filter([1, 2], Value > 5)")).toBe("Table()");
    expect(await run("Filter([], true)")).toBe("Table()");
    expect(await run("Filter([1, 2, 3], Blank())")).toBe("Table()");
  });

  it("returns Blank for a typed Blank table and propagates an error source", async () => {
    expect(await run("Filter(If(1 < 0, [1, 2, 3]), true)")).toBe("Blank()");
    expect(await run("Filter(If(1/0 < 1, [1, 2, 3]), true)")).toBe("Error:Div0");
  });

  it("turns an error predicate into an error row", async () => {
    expect(await run("Filter([1, 2, 0, 3, 4], 1/ThisRecord.Value >= 0)")).toBe(
      "Table({Value:1},{Value:2},Error:Div0,{Value:3},{Value:4})",
    );
  });

  it("passes Blank rows to the predicate as a Blank scope", async () => {
    expect(await run("Filter(Table({a: 1}, If(1 < 0, {a: 3}), {a: 4}), IsBlank(a) Or a > 2)")).toBe(
      "Table(Blank(),{a:4})",
    );
    expect(await run("Filter(Table({a: 1}, If(1 < 0, {a: 3})), a > 0)")).toBe("Table({a:1})");
  });

  it("coerces a non-Boolean predicate and rejects aggregates", async () => {
    expect(await run("Filter([1, 2, 3], Value - 1)")).toBe("Table({Value:2},{Value:3})");
    expect(await run("Filter([1], {a: 1})")).toBe(
      "invalid: Expected boolean. We expect a boolean (true/false) at this point in the formula.",
    );
  });

  it("keeps the source row order and each row's field order", async () => {
    expect(await run("Filter([{b: 2, a: 1}, {b: 4, a: 3}], b > 2)")).toBe("Table({b:4,a:3})");
  });

  it("requires a table source and exactly two arguments", async () => {
    expect(await run("Filter(1, true)")).toBe(
      "invalid: The first argument of 'Filter' should be a table.|The function 'Filter' has some invalid arguments.",
    );
    expect(await run("Filter({a: 1}, true)")).toMatch(/^invalid: The first argument of 'Filter'/);
    expect(await run("Filter(Blank(), true)")).toBe(
      "invalid: Invalid argument type.|The function 'Filter' has some invalid arguments.",
    );
    expect(await run("Filter([1])")).toBe(
      "invalid: Invalid number of arguments: received 1, expected 2.",
    );
    expect(await run("Filter([1,2,3], Value > 1, Value > 2)")).toBe(
      "invalid: Use the And operator to combine multiple predicates into the second argument.|The function 'Filter' has some invalid arguments.",
    );
  });
});

describe("row scopes", () => {
  it("does not expose fields implicitly when As names the row, but keeps ThisRecord out too", async () => {
    expect(await run("Filter([1, 2, 3] As X, Value > 2)")).toBe(NEED_NAME("Value"));
    expect(await run("Filter([1, 2, 3] As X, ThisRecord.Value > 2)")).toMatch(
      /^invalid: Name isn't valid\. 'ThisRecord' isn't recognized\./,
    );
  });

  it("lets As rename ThisRecord itself", async () => {
    expect(await run("Filter([1, 2, 3] As ThisRecord, ThisRecord.Value > 2)")).toBe(
      "Table({Value:3})",
    );
  });

  it("is case sensitive for aliases and fields", async () => {
    expect(await run("Filter([1, 2] As X, x.Value > 1)")).toMatch(
      /^invalid: Name isn't valid\. 'x' isn't recognized\./,
    );
    expect(await run("Filter([1, 2], value > 1)")).toBe(NEED_NAME("value"));
  });

  it("lets the inner scope shadow outer fields and still reach outer fields by name", async () => {
    expect(await run("With({n: 5, Value: 0}, Filter([1, 7, 9], Value > n))")).toBe(
      "Table({Value:7},{Value:9})",
    );
    expect(
      await run(
        "Filter([{Outer: 1, Value: 10}, {Outer: 5, Value: 20}], With({Value: Outer * 100}, Value > 100))",
      ),
    ).toBe("Table({Outer:5,Value:20})");
  });

  it("reaches an outer row through its alias from inside a nested scope", async () => {
    expect(await run("Filter([{a: 1}, {a: 2}] As o, With({a: 10} As i, i.a + o.a > 11))")).toBe(
      "Table({a:2})",
    );
    expect(await run("Filter([{a: 1}, {a: 2}] As o, With({a: 10}, a + o.a > 11))")).toBe(
      "Table({a:2})",
    );
  });

  it("restores the outer row after an inner scope with the same alias", async () => {
    expect(
      await run("Filter([{a: 1}, {a: 2}] As r, With({a: 100} As r, r.a) > 0 And r.a > 1)"),
    ).toBe("Table({a:2})");
  });

  it("makes ThisRecord inside With the With record, and the nearest scope wins", async () => {
    expect(await run("With({x: 5}, With(ThisRecord, ThisRecord.x + 1))")).toBe("6");
    expect(await run("With({x: 5}, With(ThisRecord, x + 1))")).toBe("6");
    expect(await run("With({x: 5}, With(ThisRecord As T2, T2.x + 1))")).toBe("6");
    expect(await run("With({x: 5}, With(ThisRecord As T2, x + 1))")).toBe("6");
    expect(await run("With({x: 5} As T1, With(T1 As T2, T1.x + T2.x))")).toBe("10");
    expect(await run("With({x: 5} As T1, With(T1 As ThisRecord, ThisRecord.x + 1))")).toBe("6");
    expect(await run("With({x: 5} As T1, x)")).toBe(NEED_NAME("x"));
  });

  it("returns the whole row when the alias is used alone", async () => {
    expect(await run("Filter([{a: 1}, {a: 2}] As r, With(r, a) > 1)")).toBe("Table({a:2})");
    expect(await run("With({x: 1}, ThisRecord)")).toBe("{x:1}");
  });

  it("makes a row field shadow a schema variable of the same name", async () => {
    expect(await run("Filter([{Flag: false}, {Flag: true}], Flag)", all({ Flag: false }))).toBe(
      "Table({Flag:true})",
    );
    expect(await run("Filter([{Name: 1}], Flag)", all({ Flag: true }))).toBe("Table({Name:1})");
  });

  it("does not leak scope names outside the Filter", async () => {
    expect(await run("Filter([1], true) & Value")).toMatch(/^invalid:/);
  });
});

describe("As placement", () => {
  it("is invalid outside a row-scope argument position", async () => {
    for (const text of [
      "1 As x",
      "If(true, 1 As x)",
      "Filter([1], Value > 0 As x)",
      "Table({a: 1} As x)",
    ]) {
      expect(await run(text), text).toMatch(/^invalid: .*As is not permitted in this context/);
    }
  });

  it("does not turn unknown functions that take As into invalid formulas", async () => {
    expect(await run("Sort([1] As x, x.Value)")).toMatch(/^unsupported/);
    expect(await run("NoSuchFunction([1] As x)")).toMatch(/^invalid/);
  });

  it("reports a missing alias name as a syntax error", () => {
    expect(engine.check("Filter([1] As , true)").ok).toBe(false);
  });
});

describe("schema variables and validated values", () => {
  it("filters a table variable and re-evaluates with other values without re-checking", async () => {
    const checked = engine.check("Filter(Scores, Score > 80)", { schema });
    expect(checked.ok).toBe(true);
    const evaluate = async (rows: unknown): Promise<string> => {
      const v = engine.validateValues(schema, all({ Scores: rows }));
      if (!v.ok) throw new Error(JSON.stringify(v.issues));
      const r = await engine.evaluateChecked(checked, { values: v.values });
      if (r.kind !== "value") throw new Error(r.kind);
      return show(r.value);
    };
    expect(await evaluate([{ Score: 90 }, { Score: 50 }])).toBe("Table({Score:90})");
    expect(await evaluate([{ Score: 10 }])).toBe("Table()");
    expect(await evaluate([])).toBe("Table()");
    expect(await evaluate([null, { Score: 99 }, {}])).toBe("Table({Score:99})");
  });

  it("treats a Blank table variable as Blank and rejects ill-typed table input", async () => {
    expect(await run("Filter(Scores, Score > 80)", all({ Scores: null }))).toBe("Blank()");
    const issues = (input: unknown): string[] => {
      const r = engine.validateValues(schema, all({ Scores: input }));
      return r.ok ? [] : r.issues.map((i) => `${i.code}:${i.path}`);
    };
    expect(issues({ Score: 1 })).toEqual(["InvalidType:Scores"]);
    expect(issues([{ Score: "x" }])).toEqual(["InvalidType:Scores[0].Score"]);
    expect(issues([{ Score: 1, Extra: 2 }])).toEqual(["UnexpectedField:Scores[0].Extra"]);
    expect(issues([1])).toEqual(["InvalidType:Scores[0]"]);
  });

  it("combines schema records, With and row scopes", async () => {
    expect(
      await run(
        "With({Limit: Customer.RiskScore}, Filter(Scores, Score > Limit))",
        all({ Customer: { RiskScore: 60 }, Scores: [{ Score: 90 }, { Score: 50 }] }),
      ),
    ).toBe("Table({Score:90})");
    expect(
      await run(
        "Filter(Scores As s, s.Score > Customer.RiskScore)",
        all({ Customer: { RiskScore: 95 }, Scores: [{ Score: 90 }] }),
      ),
    ).toBe("Table()");
    expect(
      await run("With(Filter(Scores, Score > 1), ThisRecord)", all({ Scores: [{ Score: 2 }] })),
    ).toMatch(/^invalid/);
  });

  it("filters a table produced by With and reports a mismatched schema variable as unknown", async () => {
    expect(await run("With({T: [1, 2, 3]}, Filter(T, Value > 1))")).toBe(
      "Table({Value:2},{Value:3})",
    );
    expect(await run("Filter(Missing, true)")).toBe(NEED_NAME("Missing"));
  });

  it("rejects a table or record where a scalar is needed", async () => {
    expect(await run("Items + 1", all())).toMatch(/^invalid:/);
    expect(await run("Items = Items", all())).toBe("unsupported: Record or table comparison");
    expect(await run("If(true, Items, Customer)", all())).toMatch(
      /^invalid: Argument type mismatch/,
    );
  });
});

describe("budgets, cancellation and immutability", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ Score: i }));

  it("charges one step per visited row, not only per node", async () => {
    const checked = engine.check("Filter(Scores, true)", { schema });
    const v = engine.validateValues(schema, all({ Scores: rows }));
    if (!v.ok) throw new Error("invalid input");
    const run = (maxSteps: number) =>
      new Engine({ maxSteps }).evaluateChecked(checked, { values: v.values });
    await expect(run(1500)).rejects.toThrow(/budget/);
    expect((await run(5000)).kind).toBe("value");
  });

  it("checks cancellation while walking rows", async () => {
    let calls = 0;
    const signal = {
      aborted: false,
      throwIfAborted() {
        if (++calls > 50) throw new Error("cancelled");
      },
    };
    const v = engine.validateValues(schema, all({ Scores: rows }));
    if (!v.ok) throw new Error("invalid input");
    await expect(
      engine.evaluate("Filter(Scores, true)", { schema, values: v.values, signal }),
    ).rejects.toThrow("cancelled");
  });

  it("returns deeply frozen tables, rows, fields and error rows", async () => {
    const frozen = (v: unknown): boolean =>
      typeof v !== "object" || v === null || (Object.isFrozen(v) && Object.values(v).every(frozen));
    for (const text of [
      "Table({a: 1}, {a: 2})",
      "Filter([1, 2, 0], 1/Value >= 0)",
      "With({T: [{a: 1}]}, T)",
      "Table({a: 1}, {b: 2})",
      "[1, 2/0]",
    ]) {
      const r = await engine.evaluate(text);
      if (r.kind !== "value") throw new Error(text);
      expect(frozen(r.value), text).toBe(true);
    }
  });

  it("does not let a result row be mutated through a filtered validated table", async () => {
    const v = engine.validateValues(schema, all({ Scores: [{ Score: 90 }] }));
    if (!v.ok) throw new Error("invalid input");
    const r = await engine.evaluate("Filter(Scores, true)", { schema, values: v.values });
    if (r.kind !== "value" || r.value.kind !== "Table") throw new Error("expected a table");
    const row = r.value.rows[0] as unknown as { fields: { value: { value: unknown } }[] };
    expect(() => {
      row.fields[0]!.value.value = "oops";
    }).toThrow();
    expect(() => {
      (r.value.rows as unknown as unknown[]).push(1);
    }).toThrow();
  });
});
