import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, recordType, TextType, BooleanType } from "@powerfx-ts/core";
import type { FormulaValue, ValidatedValues } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

const engine = new Engine();
const schema = defineSchema({ Customer: recordType({ RiskScore: NumberType, Name: TextType }) });
const FORMULA = 'If(Customer.RiskScore > 80, "High", "Normal")';

function valid(input: unknown, s = schema): ValidatedValues {
  const result = engine.validateValues(s, input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.values;
}

async function run(text: string, input: unknown, s = schema): Promise<unknown> {
  const result = await engine.evaluate(text, { schema: s, values: valid(input, s) });
  if (result.kind !== "value") return result;
  return show(result.value);
}

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

const errors = (text: string, s = schema): string[] =>
  engine
    .check(text, { schema: s })
    .diagnostics.map((d) => `${d.span.start}-${d.span.end}: ${d.message}`);

describe("checking against a schema (no runtime values)", () => {
  it("types the demo formula as Text without any values", () => {
    const checked = engine.check(FORMULA, { schema });
    expect(checked.ok).toBe(true);
    expect(checked.type.kind).toBe("Text");
  });

  it("reports unknown variables", () => {
    expect(errors("Missing + 1")).toEqual(["0-7: Name isn't valid. 'Missing' isn't recognized."]);
    expect(engine.check("Customer", { schema: defineSchema({}) }).ok).toBe(false);
    expect(engine.check("Customer").ok).toBe(false);
  });

  it("treats member access on an unresolved leading name as unsupported, not invalid", () => {
    const checked = engine.check("Color.Red", { schema });
    expect(checked.unsupported.map((u) => u.feature)).toEqual(["Member access on 'Color'"]);
  });

  it("is case sensitive for variables and fields", () => {
    expect(engine.check("customer.RiskScore", { schema }).ok).toBe(false);
    expect(engine.check("Customer.riskscore", { schema }).ok).toBe(false);
  });

  it("reports unknown fields from the dot to the end of the name (upstream span)", () => {
    expect(errors("Customer.Nope")).toEqual(["8-13: Name isn't valid. 'Nope' isn't recognized."]);
  });

  it("reports the dot operator on non-records, cascading on errors like upstream", () => {
    expect(errors("Customer.RiskScore.x")).toEqual([
      "18-20: The '.' operator cannot be used on Number values.",
    ]);
    expect(errors("Customer.Nope.x")).toEqual([
      "8-13: Name isn't valid. 'Nope' isn't recognized.",
      "13-15: The '.' operator cannot be used on Error values.",
    ]);
  });

  it("rejects records where scalars are needed and does not compare records", () => {
    expect(errors("Customer + 1")[0]).toContain("Invalid argument type");
    expect(errors("Not(Customer)").length + errors("If(Customer, 1)").length).toBeGreaterThan(0);
    expect(engine.check("Customer = Customer", { schema }).unsupported).toHaveLength(1);
  });

  it("rejects nested record schema misuse via field types", () => {
    const nested = defineSchema({ A: recordType({ B: recordType({ C: BooleanType }) }) });
    expect(engine.check("If(A.B.C, 1, 2)", { schema: nested }).type.kind).toBe("Number");
    expect(errors("A.B.D", nested)).toEqual(["3-5: Name isn't valid. 'D' isn't recognized."]);
  });
});

describe("evaluating with separately supplied values", () => {
  it("evaluates the demo formula for different values with one schema", async () => {
    const checked = engine.check(FORMULA, { schema });
    const outcome = async (score: number | null): Promise<unknown> =>
      show(
        (
          (await engine.evaluateChecked(checked, {
            values: valid({ Customer: { RiskScore: score, Name: "A" } }),
          })) as { value: FormulaValue }
        ).value,
      );
    expect(await outcome(90)).toBe('"High"');
    expect(await outcome(80)).toBe('"Normal"');
    expect(await outcome(50)).toBe('"Normal"');
    expect(await outcome(null)).toBe('"Normal"');
  });

  it("evaluates through evaluate() as well", async () => {
    expect(await run(FORMULA, { Customer: { RiskScore: 81, Name: "x" } })).toBe('"High"');
  });

  it("treats Blank records and Blank fields as Blank", async () => {
    expect(await run("IsBlank(Customer)", { Customer: null })).toBe("true");
    expect(await run("IsBlank(Customer.Name)", { Customer: null })).toBe("true");
    expect(await run("IsBlank(Customer.Name)", { Customer: { RiskScore: 1 } })).toBe("true");
    expect(await run("Customer.RiskScore + 1", { Customer: { RiskScore: null } })).toBe("1");
    expect(await run("Customer.RiskScore", { Customer: null })).toBe("Blank()");
  });

  it("returns a record value when the formula result is a record", async () => {
    expect(await run("Customer", { Customer: { RiskScore: 2, Name: "n" } })).toBe(
      '{RiskScore:2,Name:"n"}',
    );
  });

  it("reports invalid and unsupported results from checking", async () => {
    expect(await run("Nope", { Customer: null })).toMatchObject({ kind: "invalid" });
  });

  it("rejects values validated against a different schema, and missing values", async () => {
    const other = defineSchema({ X: NumberType });
    await expect(engine.evaluate("X", { schema, values: valid({ X: 1 }, other) })).rejects.toThrow(
      /different schema/,
    );
    await expect(engine.evaluate("Customer", { schema })).rejects.toThrow(/required/);
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.evaluate(FORMULA, {
        schema,
        values: valid({ Customer: null }),
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
  });
});

describe("validating host input", () => {
  const issues = (input: unknown): string[] => {
    const r = engine.validateValues(schema, input);
    return r.ok ? [] : r.issues.map((i) => `${i.code}:${i.path}`);
  };

  it("accepts null/undefined as Blank and omitted record fields", () => {
    expect(issues({ Customer: null })).toEqual([]);
    expect(issues({ Customer: { RiskScore: undefined } })).toEqual([]);
  });

  it("rejects wrongly typed input without coercion", () => {
    expect(issues({ Customer: { RiskScore: "90" } })).toEqual(["InvalidType:Customer.RiskScore"]);
    expect(issues({ Customer: { RiskScore: NaN } })).toEqual(["InvalidType:Customer.RiskScore"]);
    expect(issues({ Customer: { RiskScore: Infinity } })).toEqual([
      "InvalidType:Customer.RiskScore",
    ]);
    expect(issues({ Customer: { Name: 5 } })).toEqual(["InvalidType:Customer.Name"]);
    expect(issues({ Customer: [] })).toEqual(["InvalidType:Customer"]);
    expect(issues({ Customer: "x" })).toEqual(["InvalidType:Customer"]);
  });

  it("rejects missing variables and unexpected variables/fields", () => {
    expect(issues({})).toEqual(["MissingVariable:Customer"]);
    expect(issues({ Customer: null, Other: 1 })).toEqual(["UnexpectedVariable:Other"]);
    expect(issues({ Customer: { Extra: 1 } })).toEqual(["UnexpectedField:Customer.Extra"]);
    expect(issues(null)).toEqual(["InvalidType:"]);
  });

  it("does not treat inherited properties as supplied", () => {
    expect(issues(Object.create({ Customer: null }))).toEqual(["InvalidType:"]);
    expect(issues({ Customer: { toString: 1 } })).toEqual(["UnexpectedField:Customer.toString"]);
  });
});
