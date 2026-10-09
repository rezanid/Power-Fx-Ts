import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, recordType, TextType } from "@powerfx-ts/core";
import type { FormulaValue } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

const engine = new Engine();
const schema = defineSchema({ Customer: recordType({ RiskScore: NumberType, Name: TextType }) });
const DEMO = 'With({Score: Customer.RiskScore}, If(Score > 80, "High", "Normal"))';

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
    case "Error":
      return `Error:${v.errors[0]?.kind}`;
  }
}

async function run(text: string, input?: unknown): Promise<string> {
  const options =
    input === undefined
      ? {}
      : (() => {
          const r = engine.validateValues(schema, input);
          if (!r.ok) throw new Error(JSON.stringify(r.issues));
          return { schema, values: r.values };
        })();
  const result = await engine.evaluate(text, options);
  if (result.kind === "invalid")
    return `invalid: ${result.diagnostics.map((d) => d.message).join("|")}`;
  if (result.kind === "unsupported")
    return `unsupported: ${result.features.map((f) => f.feature).join("|")}`;
  return show(result.value);
}

const diag = (text: string): string[] =>
  engine
    .check(text, { schema })
    .diagnostics.map((d) => `${d.span.start}-${d.span.end}: ${d.message}`);

describe("demo formula", () => {
  it("checks against the schema once and evaluates with different values", async () => {
    const checked = engine.check(DEMO, { schema });
    expect(checked.ok).toBe(true);
    expect(checked.type.kind).toBe("Text");
    for (const [score, expected] of [
      [90, '"High"'],
      [80, '"Normal"'],
      [50, '"Normal"'],
      [null, '"Normal"'],
    ] as const) {
      const v = engine.validateValues(schema, { Customer: { RiskScore: score, Name: "A" } });
      if (!v.ok) throw new Error("invalid");
      const r = await engine.evaluateChecked(checked, { values: v.values });
      expect(r.kind === "value" ? show(r.value) : r.kind).toBe(expected);
    }
  });
});

describe("record literals", () => {
  it("types and evaluates fields, including nested records", async () => {
    expect(engine.check("{a: 1, b: {c: true}}").type).toEqual({
      kind: "Record",
      fields: [
        { name: "a", type: NumberType },
        { name: "b", type: { kind: "Record", fields: [{ name: "c", type: { kind: "Boolean" } }] } },
      ],
    });
    expect(await run("{a: 1, b: {c: 2 + 2}}.b.c")).toBe("4");
  });

  it("normalizes field order by ordinal name", async () => {
    expect(await run("{b: 2, a: 1}")).toBe("{a:1,b:2}");
  });

  it("reports duplicate fields on the later value", () => {
    const d = diag("{a: 1, a: 2}");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatch(/^10-11: .*'a'/);
  });

  it("treats field names as case-sensitive", async () => {
    expect(await run("{x: 3, X: 5}.x ^ {x: 3, X: 5}.X")).toBe("243");
  });

  it("returns frozen records", async () => {
    const r = await engine.evaluate("{a: {b: 1}}");
    if (r.kind !== "value" || r.value.kind !== "Record") throw new Error("expected record");
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value.fields)).toBe(true);
    expect(() => (r.value.fields as unknown as unknown[]).push(1)).toThrow();
  });

  it("keeps a field error in the record and surfaces it on access", async () => {
    expect(await run("{a: 1/0}")).toBe("{a:Error:Div0}");
    expect(await run("{a: 1/0}.a")).toBe("Error:Div0");
  });
});

describe("With", () => {
  it("resolves locals, shadowing and nested scopes", async () => {
    expect(await run("With({x: 5}, x * 2)")).toBe("10");
    // the inner scope argument resolves against the outer scope
    expect(await run("With({x: 5}, With({x: x * 2}, x))")).toBe("10");
    expect(await run("With({x: 5}, With({y: x + 1}, x + y))")).toBe("11");
    expect(await run("With({x: 3, X: 5}, x ^ X)")).toBe("243");
  });

  it("lets With fields shadow schema variables", async () => {
    const input = { Customer: { RiskScore: 1, Name: "A" } };
    expect(await run("With({Customer: {RiskScore: 99}}, Customer.RiskScore)", input)).toBe("99");
    expect(await run("With({Score: 1}, Customer.RiskScore)", input)).toBe("1");
  });

  it("uses schema variables and validated values", async () => {
    expect(await run(DEMO, { Customer: { RiskScore: 90, Name: "A" } })).toBe('"High"');
    expect(await run(DEMO, { Customer: { RiskScore: null, Name: "A" } })).toBe('"Normal"');
  });

  it("is lazy: a Blank or Error scope skips the body", async () => {
    expect(await run("With(Blank(), 1/0)")).toBe("Blank()");
    expect(await run("With(Blank(), Blank())")).toBe("Blank()");
    expect(await run("With(If(1/0 > 0, {a: 1}, {a: 2}), 5)")).toBe("Error:Div0");
  });

  it("treats a Blank field as Blank, coerced to zero in arithmetic", async () => {
    expect(await run("With({x: Blank()}, x * x)")).toBe("0");
  });

  it("restores outer scope values after an inner With", async () => {
    expect(await run("With({x: 1}, With({x: 2}, x) + x)")).toBe("3");
  });

  it("reports unknown names in the body and unsupported row scopes", async () => {
    expect(diag("With({x: 1}, y)")).toHaveLength(1);
    expect(await run("With({x: 1}, ThisRecord.x)")).toMatch(/^unsupported/);
  });

  it("rejects a non-record scope argument and wrong arity", () => {
    const d = diag("With(1, 2)");
    expect(d.some((m) => m.includes("Expecting a Record value"))).toBe(true);
    expect(diag("With({x: 1})").length).toBeGreaterThan(0);
    expect(diag("With({x: 1}, 1, 2)").length).toBeGreaterThan(0);
  });

  it("does not hide a field access error on a local", () => {
    expect(diag("With({x: 3}, x.y)")).toEqual([
      expect.stringContaining("The '.' operator cannot be used on Number values."),
    ]);
  });
});

describe("If with record results", () => {
  it("rejects a record mixed with a scalar", () => {
    expect(diag('If(true, {a: 1}, "test")').length).toBe(1);
  });
  it("leaves differing record types unsupported", async () => {
    expect(await run("If(false, {x: 1}, {z: 2})")).toMatch(/^unsupported/);
  });
  it("accepts identical record types", async () => {
    expect(await run("If(true, {x: 1}, {x: 2})")).toBe("{x:1}");
  });
});
