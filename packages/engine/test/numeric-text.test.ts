import { describe, expect, it } from "vitest";
import { defineSchema, TextType } from "@powerfx-ts/core";
import type { FormulaValue } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

// Behavior-level tests for culture-aware numeric text parsing (ADR 0010). The exhaustive
// compatibility evidence is the reference replay in numeric-text-vectors.test.ts; these tests pin
// the semantic rules and the integration points one by one.
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
    case "Error":
      return `Error:${v.errors[0]?.kind}`;
    default:
      return v.kind;
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

describe("en-US grammar", () => {
  it.each([
    ["1,000.5", "D1000.5"],
    ["$1,000.50", "D1000.5"],
    ["1,000.50 $", "D1000.5"],
    ["(12)", "D-12"],
    ["-(12)", "D12"],
    ["12-", "D-12"],
    ["-12-", "D12"],
    ["  12\u00a0", "D12"],
    ["12%", "D0.12"],
    ["%12", "D0.12"],
    ["-12 %", "D-0.12"],
    ["(12)%", "D-0.12"],
    ["1e3", "D1000"],
    ["1,,000", "D1000"],
    ["5.", "D5"],
    [".5", "D0.5"],
    ["1\u0000", "D1"],
  ])("Decimal(%j) = %s", async (text, expected) => {
    expect(await d(`Decimal("${text}")`)).toBe(expected);
  });

  it.each([
    ",1",
    "12%%",
    "%12%",
    "12%-",
    "(12%)",
    "( 12)",
    "$$12",
    "$12€",
    "--1",
    "+-1",
    "1e",
    "e3",
    "NaN",
    "Infinity",
    "0x10",
    "\u0661\u0662",
    "\u221212",
    "\u200b12",
    "1\u00a02",
    " ",
    "\t",
    "(12",
    "12)",
  ])("Decimal(%j) is invalid", async (text) => {
    expect(await d(`Decimal("${text}")`)).toBe("Error:InvalidArgument");
    expect(await d(`Float("${text}")`)).toBe("Error:InvalidArgument");
  });

  it("returns Blank for the empty string and keeps whitespace-only text invalid", async () => {
    expect(await d('Decimal("")')).toBe("Blank()");
    expect(await d('Float("")')).toBe("Blank()");
    expect(await d('Decimal("  ")')).toBe("Error:InvalidArgument");
    expect(await d('IsBlank(Decimal(""))')).toBe("true");
  });
});

describe("fr-FR grammar", () => {
  it.each([
    ["1,5", "D1.5"],
    ["1 000,5", "D1000.5"],
    ["1\u202f000,5", "D1000.5"],
    ["12 €", "D12"],
    ["12,5%", "D0.125"],
    ["(1 000,5)", "D-1000.5"],
  ])("Decimal(%j, fr-FR) = %s", async (text, expected) => {
    expect(await d(`Decimal("${text}","fr-FR")`)).toBe(expected);
  });

  it("treats en-US shaped text differently", async () => {
    expect(await d('Decimal("1,000.5","fr-FR")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1.5","fr-FR")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("$12","fr-FR")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("12 €")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1,000")')).toBe("D1000");
    expect(await d('Decimal("1,000","fr-FR")')).toBe("D1");
  });

  it("does not accept a non-breaking space group separator, but does accept ASCII space", async () => {
    expect(await d('Decimal("1\u00a0000,5","fr-FR")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1 000,5","fr-FR")')).toBe("D1000.5");
  });

  it("accepts the same locale spellings as the reference for supported cultures", async () => {
    for (const name of ["fr-FR", "fr-fr", "FR-FR", "fr", "fr_FR"]) {
      expect(await d(`Decimal("1,5","${name}")`), name).toBe("D1.5");
    }
    for (const name of ["en-US", "en-us", "EN-US", "en", "en_US"]) {
      expect(await d(`Decimal("1,5","${name}")`), name).toBe("D15");
    }
  });
});

describe("range, rounding and precision", () => {
  it("keeps all digits of decimal text (never routed through a JS number)", async () => {
    expect(await d('Decimal("0.1234567890123456789012345678")')).toBe(
      "D0.1234567890123456789012345678",
    );
    expect(await d('Decimal("79228162514264337593543950335")')).toBe(
      "D79228162514264337593543950335",
    );
    expect(await d('Decimal("9007199254740993")')).toBe("D9007199254740993");
  });
  it("rounds half to even at 28 places and reports overflow as InvalidArgument", async () => {
    expect(await d('Decimal("0.00000000000000000000000000005")')).toBe("D0");
    expect(await d('Decimal("0.00000000000000000000000000015")')).toBe(
      "D0.0000000000000000000000000002",
    );
    expect(await d('Decimal("0.00000000000000000000000000025")')).toBe(
      "D0.0000000000000000000000000002",
    );
    expect(await d('Decimal("79228162514264337593543950336")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1e29")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1e99999999999")')).toBe("Error:InvalidArgument");
    expect(await d('Decimal("1e-99999999999")')).toBe("D0");
  });
  it("applies the percent division with decimal rounding", async () => {
    expect(await d('Decimal("79228162514264337593543950335%")')).toBe(
      "D792281625142643375935439503.35",
    );
    expect(await d('Decimal("5e-28%")')).toBe("D0");
  });
  it("Float is the nearest double, overflow is invalid, underflow is zero", async () => {
    expect(await f('Float("0.1")')).toBe("F0.1");
    expect(await f('Float("1e308")')).toBe("F1E+308");
    expect(await f('Float("1e309")')).toBe("Error:InvalidArgument");
    expect(await f('Float("1e-400")')).toBe("F0");
    expect(await f('Float("5e-324")')).toBe("F5E-324");
    expect(await f('Float("9007199254740993")')).toBe("F9.007199254740992E+15");
  });
  it("preserves the sign of a float zero", async () => {
    expect(await f('Float("-0")&""')).toBe('"-0"');
    expect(await f('Float("(0)")&""')).toBe('"-0"');
    expect(await d('Decimal("-0")&""')).toBe('"0"');
  });
});

describe("Value and implicit coercion", () => {
  it("Value yields the profile's default numeric kind", async () => {
    expect(await d('Value("1,5","fr-FR")')).toBe("D1.5");
    expect(await f('Value("1,5","fr-FR")')).toBe("F1.5");
  });
  it("implicit Text→number coercion uses the en-US rules of Decimal()/Float()", async () => {
    expect(await d('"$1,000"*2')).toBe("D2000");
    expect(await d('"12%"+1')).toBe("D1.12");
    expect(await d('"1,5"+"2,5"')).toBe("D40");
    expect(await f('"1,5"+"2,5"')).toBe("F40");
    expect(await d('""+1')).toBe("D1");
    expect(await d('" "+1')).toBe("Error:InvalidArgument");
  });
});

describe("locale argument", () => {
  it("propagates Blank and errors before the locale is used", async () => {
    expect(await d('Decimal("1,5",Blank())')).toBe("Blank()");
    expect(await d('Decimal(Blank(),"fr-FR")')).toBe("Blank()");
    expect(await d('Decimal("1",If(false,"fr-FR"))')).toBe("Blank()");
    expect(await d('Decimal(1/0,"fr-FR")')).toBe("Error:Div0");
    expect(await d('Decimal(1,"fr-FR")')).toBe("D1");
    expect(await d('Float(true,"fr-FR")')).toBe("F1");
  });
  it("is evaluated lazily as an ordinary argument", async () => {
    expect(await d('Decimal("1,5",If(true,"fr-FR",1/0))')).toBe(
      "Invalid".length ? await d('Decimal("1,5","fr-FR")') : "",
    );
  });
  it("must be Text: other types are diagnostics", async () => {
    for (const bad of ["1", "true", "{a:1}", "1/0"]) {
      expect(await d(`Decimal("1",${bad})`), bad).toMatch(/^invalid/);
    }
    expect(await d('Decimal("1","fr-FR","x")')).toMatch(/^invalid.*expected 1-2/);
    expect(await d("Decimal()")).toMatch(/^invalid/);
    expect(await d("Value()")).toMatch(/^invalid/);
    expect(await d("Decimal({a:1})")).toMatch(/^invalid/);
  });
  it("reports locales outside en-US/fr-FR as unsupported, never as invalid or a formula error", async () => {
    expect(await d('Decimal("1","de-DE")')).toBe("unsupported: locale 'de-DE'");
    expect(await f('Float("1","xx")')).toBe("unsupported: locale 'xx'");
    expect(await d('Value("1","")')).toBe("unsupported: locale ''");
    expect(await d('Decimal("1","en-US ")')).toMatch(/^unsupported/);
  });
  it("reports a computed unsupported locale at run time", async () => {
    const schema = defineSchema({ Loc: TextType });
    const checked = dec.check('Decimal("1,5", Loc)', { schema });
    expect(checked.ok).toBe(true);
    const run = async (loc: string) => {
      const v = dec.validateValues(schema, { Loc: loc });
      if (!v.ok) throw new Error("bad values");
      return dec.evaluateChecked(checked, { values: v.values });
    };
    const ok = await run("fr-FR");
    expect(ok.kind === "value" && show(dec, ok.value)).toBe("D1.5");
    const unsupported = await run("de-DE");
    expect(unsupported.kind).toBe("unsupported");
    if (unsupported.kind === "unsupported") {
      expect(unsupported.features[0]?.feature).toBe("locale 'de-DE'");
    }
  });
  it("a Blank first argument wins over an unsupported computed locale", async () => {
    const schema = defineSchema({ Loc: TextType });
    const checked = dec.check("Decimal(Blank(), Loc)", { schema });
    const v = dec.validateValues(schema, { Loc: "de-DE" });
    if (!v.ok) throw new Error("bad values");
    const r = await dec.evaluateChecked(checked, { values: v.values });
    expect(r.kind === "value" && show(dec, r.value)).toBe("Blank()");
  });
});

describe("boundaries between text parsing, formula source and host input", () => {
  it("formula decimal and argument separators are unchanged", async () => {
    expect(await d("Decimal(1.5)")).toBe("D1.5");
    expect(await d("Decimal(1,5)")).toMatch(/^invalid/);
  });
  it("host input stays strict: culture text is not accepted for Decimal fields", () => {
    const schema = defineSchema({ Amount: { kind: "Decimal" } });
    for (const text of ["1,5", "$12", "12%", " 12", "(12)", "1 000"]) {
      expect(dec.validateValues(schema, { Amount: text }).ok, text).toBe(false);
    }
    expect(dec.validateValues(schema, { Amount: "12.5" }).ok).toBe(true);
  });
});

describe("locale precedence is identical for literal and computed locales", () => {
  const schema = defineSchema({ Loc: TextType });
  const viaVariable = async (e: Engine, formula: string) => {
    const checked = e.check(formula, { schema });
    if (!checked.ok) return "invalid";
    const v = e.validateValues(schema, { Loc: "de-DE" });
    if (!v.ok) throw new Error("bad values");
    const r = await e.evaluateChecked(checked, { values: v.values });
    return r.kind === "value" ? show(e, r.value) : r.kind;
  };
  it.each(["Decimal", "Float", "Value"])("%s", async (fn) => {
    for (const e of [dec, flt]) {
      const k = e === dec ? "Blank()" : "Blank()";
      expect(await run(e, `${fn}(Blank(),"de-DE")`)).toBe(k);
      expect(await viaVariable(e, `${fn}(Blank(),Loc)`)).toBe(k);
      expect(await run(e, `${fn}(1/0,"de-DE")`)).toBe("Error:Div0");
      expect(await viaVariable(e, `${fn}(1/0,Loc)`)).toBe("Error:Div0");
      expect(await run(e, `${fn}("1","de-DE")`)).toBe("unsupported: locale 'de-DE'");
      expect(await viaVariable(e, `${fn}("1",Loc)`)).toBe("unsupported");
      expect(await run(e, `${fn}("1",Blank())`)).toBe("Blank()");
    }
  });
});
