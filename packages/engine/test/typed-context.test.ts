import { describe, expect, it } from "vitest";
import { defineSchema, NumberType, recordType, TextType, BooleanType } from "@powerfx-ts/core";
import type { FormulaValue, ValidatedValues } from "@powerfx-ts/interpreter";
import { floatBackend } from "@powerfx-ts/interpreter";
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

  it("only built-in upstream enum roots are unsupported; other unknown roots are unknown names", () => {
    const typo = engine.check("Custmer.RiskScore", { schema });
    expect(typo.unsupported).toEqual([]);
    expect(typo.ok).toBe(false);
    expect(typo.diagnostics.map((d) => d.message)).toContain(
      "Name isn't valid. 'Custmer' isn't recognized.",
    );
    expect(engine.check("color.Red", { schema }).unsupported).toEqual([]); // case-sensitive
    for (const root of ["Color", "TimeUnit", "ErrorKind", "SortOrder"]) {
      expect(engine.check(`${root}.X`, { schema }).unsupported).toHaveLength(1);
    }
  });

  it("lets a schema variable shadow an enum name", () => {
    const shadow = defineSchema({ Color: recordType({ Red: NumberType }) });
    expect(engine.check("Color.Red", { schema: shadow }).ok).toBe(true);
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

describe("reusing checked results", () => {
  it("snapshots the schema: mutating the host object after check changes nothing", async () => {
    const mutable = {
      variables: [{ name: "X", type: { kind: "Number" } }],
    } as unknown as { variables: { name: string; type: { kind: string } }[] };
    const checked = engine.check("X + 1", { schema: mutable as never });
    mutable.variables[0]!.type.kind = "Text";
    mutable.variables.push({ name: "Y", type: { kind: "Number" } });
    expect(checked.schema?.variables).toHaveLength(1);
    expect(checked.type.kind).toBe("Number");
    expect(Object.isFrozen(checked.schema)).toBe(true);
    const frozen = engine.validateValues(checked.schema!, { X: 1 });
    expect(frozen.ok).toBe(true);
    // Values validated against the mutated schema are rejected.
    const stale = engine.validateValues(mutable as never, { X: "a", Y: 1 });
    if (!stale.ok) throw new Error("expected valid values");
    await expect(engine.evaluateChecked(checked, { values: stale.values })).rejects.toThrow(
      /different schema/,
    );
  });

  it("keys reuse on backend identity, not name: same-named custom backends are incompatible", async () => {
    const a = new Engine({ numeric: { ...floatBackend } });
    const b = new Engine({ numeric: { ...floatBackend } });
    const sch = defineSchema({ X: NumberType });
    const checked = a.check("X + 1", { schema: sch });
    const mine = a.validateValues(sch, { X: 1 });
    const theirs = b.validateValues(sch, { X: 1 });
    if (!mine.ok || !theirs.ok) throw new Error("expected valid values");
    expect((await a.evaluateChecked(checked, { values: mine.values })).kind).toBe("value");
    await expect(b.evaluateChecked(checked, { values: theirs.values })).rejects.toThrow(
      /different numeric configuration/,
    );
    await expect(a.evaluateChecked(checked, { values: theirs.values })).rejects.toThrow(
      /different numeric configuration/,
    );
    // Engines sharing one backend instance remain interchangeable.
    const shared = { ...floatBackend };
    const c = new Engine({ numeric: shared });
    const d = new Engine({ numeric: shared });
    const cv = c.validateValues(sch, { X: 2 });
    if (!cv.ok) throw new Error("expected valid values");
    expect(
      (await d.evaluateChecked(c.check("X", { schema: sch }), { values: cv.values })).kind,
    ).toBe("value");
  });

  it("rejects reuse with an incompatible numeric configuration", async () => {
    const other = new Engine({ numeric: { ...floatBackend, name: "decimal" } });
    const checked = engine.check("X + 1", { schema: defineSchema({ X: NumberType }) });
    const values = valid({ X: 1 }, defineSchema({ X: NumberType }));
    await expect(other.evaluateChecked(checked, { values })).rejects.toThrow(
      /numeric configuration/,
    );
    const otherChecked = other.check("X + 1", { schema: defineSchema({ X: NumberType }) });
    await expect(engine.evaluateChecked(otherChecked, { values })).rejects.toThrow(
      /numeric configuration/,
    );
    const otherValues = other.validateValues(defineSchema({ X: NumberType }), { X: 1 });
    if (!otherValues.ok) throw new Error("expected valid values");
    await expect(engine.evaluateChecked(checked, { values: otherValues.values })).rejects.toThrow(
      /numeric configuration/,
    );
  });
});

describe("nested records", () => {
  const nested = defineSchema({
    A: recordType({ N: NumberType, B: recordType({ C: BooleanType, D: TextType }) }),
  });
  const nestedIssues = (input: unknown): string[] => {
    const r = engine.validateValues(nested, input);
    return r.ok ? [] : r.issues.map((i) => `${i.code}:${i.path}`);
  };

  it("treats omitted nested fields and records as Blank", async () => {
    expect(await run("IsBlank(A.B.C)", { A: {} }, nested)).toBe("true");
    expect(await run("IsBlank(A.B.C)", { A: { B: {} } }, nested)).toBe("true");
    expect(await run("A.B.D", { A: { B: { D: "x" } } }, nested)).toBe('"x"');
  });

  it("propagates a Blank parent through nested access", async () => {
    expect(await run("IsBlank(A.B.D)", { A: null }, nested)).toBe("true");
    expect(await run("IsBlank(A.B.D)", { A: { B: null } }, nested)).toBe("true");
    expect(await run("If(A.B.C, 1, 2)", { A: null }, nested)).toBe("2");
  });

  it("reports full paths for wrong nested types, unexpected fields and several issues at once", () => {
    expect(nestedIssues({ A: { B: { C: "yes" } } })).toEqual(["InvalidType:A.B.C"]);
    expect(nestedIssues({ A: { B: 3 } })).toEqual(["InvalidType:A.B"]);
    expect(nestedIssues({ A: { B: { Z: 1 } } })).toEqual(["UnexpectedField:A.B.Z"]);
    expect(nestedIssues({ A: { N: "1", B: { C: 1, D: 2 } } })).toEqual([
      "InvalidType:A.N",
      "InvalidType:A.B.C",
      "InvalidType:A.B.D",
    ]);
  });
});

describe("which inputs must be supplied", () => {
  it("requires every declared variable, even if the formula does not reference it", () => {
    const two = defineSchema({ A: NumberType, B: NumberType });
    const r = engine.validateValues(two, { A: 1 });
    expect(r.ok).toBe(false);
    expect(engine.validateValues(two, { A: 1, B: null }).ok).toBe(true);
  });

  it("rejects extra variables and extra record fields rather than ignoring them", () => {
    expect(engine.validateValues(schema, { Customer: null, Extra: 1 }).ok).toBe(false);
    expect(engine.validateValues(schema, { Customer: { Extra: 1 } }).ok).toBe(false);
  });
});

describe("validated values are immutable at runtime", () => {
  const sch = defineSchema({ N: NumberType, C: recordType({ Score: NumberType }) });
  const get = (): ValidatedValues => valid({ N: 1, C: { Score: 5 } }, sch);

  it("has no working map mutators", () => {
    const m = get().values as unknown as Record<string, unknown>;
    for (const op of ["set", "delete", "clear"]) {
      expect(m[op]).toBeUndefined();
    }
    expect(Object.isFrozen(get())).toBe(true);
    expect(() => {
      (get() as { values: unknown }).values = new Map();
    }).toThrow(TypeError);
    expect(get().values.get("N")?.kind).toBe("Number");
    expect([...get().values.keys()]).toEqual(["N", "C"]);
  });

  it("freezes scalar and nested record values", () => {
    const n = get().values.get("N") as { value: unknown };
    expect(() => {
      n.value = 0;
    }).toThrow(TypeError);
    const c = get().values.get("C") as { fields: { name: string; value: unknown }[] };
    expect(() => c.fields.push({ name: "X", value: null })).toThrow(TypeError);
    expect(() => {
      c.fields[0]!.value = null;
    }).toThrow(TypeError);
    expect(() => {
      c.fields[0]!.name = "Other";
    }).toThrow(TypeError);
    const inner = c.fields[0]!.value as { value: unknown };
    expect(() => {
      inner.value = 0;
    }).toThrow(TypeError);
  });

  it("returns frozen record results, so evaluation cannot leak mutable state", async () => {
    const values = get();
    const result = await engine.evaluate("C", { schema: sch, values });
    if (result.kind !== "value" || result.value.kind !== "Record")
      throw new Error("expected record");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(() => (result.value as { fields: unknown[] }).fields.push(1)).toThrow(TypeError);
    expect(await run("C.Score + N", { N: 1, C: { Score: 5 } }, sch)).toBe("6");
  });

  it("is unaffected by later mutation of the host's input object", async () => {
    const input = { N: 1, C: { Score: 5 } };
    const values = valid(input, sch);
    input.C.Score = 99;
    const checked = engine.check("C.Score", { schema: sch });
    const r = await engine.evaluateChecked(checked, { values });
    expect(r.kind === "value" && show(r.value)).toBe("5");
  });
});
