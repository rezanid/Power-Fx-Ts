import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { floatBackend } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

// Differential tests for culture-aware numeric text parsing (ADR 0010). Every vector was evaluated
// by the pinned upstream C# implementation in the named mode (tools/reference-harness,
// `generate-text`); expectations are the reference's, never derived from Intl or from our parser.
interface Vector {
  group: string;
  mode: "float" | "decimal";
  expr: string;
  kind: string;
  value: string;
}
interface CultureData {
  name: string;
  decimalSeparator: string;
  groupSeparator: string;
  currencySymbol: string;
  positiveSign: string;
  negativeSign: string;
}
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/numeric-text-vectors.json", import.meta.url), "utf8"),
) as { upstream: string; cultures: CultureData[]; entries: Vector[] };

const engines = { float: new Engine(), decimal: new Engine({ numberMode: "decimal" }) };
const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function sameDecimal(a: string, b: string): boolean {
  const scaled = (t: string): { m: bigint; s: number } => {
    const m = DECIMAL_TEXT.exec(t);
    if (m === null) throw new Error(`not a decimal: ${t}`);
    const f = m[3] ?? "";
    return { m: BigInt(`${m[1]}${m[2]}${f}` || "0"), s: f.length - Number(m[4] ?? "0") };
  };
  const x = scaled(a);
  const y = scaled(b);
  const c = Math.max(x.s, y.s);
  return x.m * 10n ** BigInt(c - x.s) === y.m * 10n ** BigInt(c - y.s);
}

/** The locale string literals a vector passes, in order of appearance. */
const localeOf = (expr: string): string | undefined => /,"([^"]*)"\)$/.exec(expr)?.[1];

// Locale names this engine claims to support, stated independently of the implementation.
const SUPPORTED = new Set([
  "en-US",
  "en-us",
  "EN-US",
  "fr-FR",
  "fr-fr",
  "FR-FR",
  "en",
  "fr",
  "en_US",
  "fr_FR",
]);

interface Outcome {
  kind: string;
  value: string;
}
async function run(v: Vector): Promise<Outcome> {
  const engine = engines[v.mode];
  const r = await engine.evaluate(v.expr);
  if (r.kind === "invalid") return { kind: "Invalid", value: "" };
  if (r.kind === "unsupported") return { kind: "Unsupported", value: r.features[0]!.feature };
  const x = r.value;
  switch (x.kind) {
    case "Decimal":
      return { kind: "Decimal", value: engine.formatDecimal(x.value) };
    case "Number": {
      // The raw double: the serializer prints negative zero as "0" (formatting is out of scope here).
      const n = floatBackend.toNumber(x.value);
      return { kind: "Number", value: Object.is(n, -0) ? "-0" : engine.formatNumber(x.value) };
    }
    case "Error":
      return { kind: "Error", value: x.errors[0]?.kind ?? "" };
    case "Text":
      return { kind: "Text", value: x.value };
    case "Boolean":
      return { kind: "Boolean", value: String(x.value) };
    default:
      return { kind: x.kind, value: "" };
  }
}

function agrees(v: Vector, o: Outcome): boolean {
  if (o.kind !== v.kind) return false;
  if (v.kind === "Invalid" || v.kind === "Blank") return true;
  if (v.kind === "Decimal") return sameDecimal(v.value, o.value);
  // Object.is: the sign of zero is part of the double.
  if (v.kind === "Number") return Object.is(Number(v.value), Number(o.value));
  return v.value === o.value;
}

const groups = Map.groupBy(fixture.entries, (e) => e.group);
const culturesByName = new Map(fixture.cultures.map((c) => [c.name, c]));

describe("numeric text parsing against the pinned C# reference", () => {
  it("pins the upstream commit and covers every context in both modes", () => {
    expect(fixture.upstream).toBe("df4ceba5e08220db670c25afead342ce699c50b5");
    for (const g of [
      "text-decimal",
      "text-float",
      "text-value",
      "text-implicit",
      "text-decimal-en-US",
      "text-decimal-fr-FR",
      "text-float-en-US",
      "text-float-fr-FR",
      "text-value-fr-FR",
      "locale-name",
      "locale-name-float",
      "text-misc",
    ]) {
      expect(groups.get(g)?.length ?? 0, g).toBeGreaterThan(50);
    }
    expect(fixture.entries.length).toBeGreaterThan(7000);
    expect(new Set(fixture.entries.map((e) => e.mode))).toEqual(new Set(["float", "decimal"]));
  });

  it("culture data matches what the reference runtime reports", async () => {
    const { EN_US, FR_FR } = await import("@powerfx-ts/core");
    for (const ours of [EN_US, FR_FR]) {
      const reference = culturesByName.get(ours.name)!;
      expect(ours.decimalSeparator).toBe(reference.decimalSeparator);
      expect(ours.groupSeparator).toBe(reference.groupSeparator);
      expect(ours.currencySymbol).toBe(reference.currencySymbol);
      expect(ours.positiveSign).toBe(reference.positiveSign);
      expect(ours.negativeSign).toBe(reference.negativeSign);
    }
  });

  for (const [group, entries] of groups) {
    it(`${group}: ${entries.length} vectors match or are explicitly unsupported`, async () => {
      const failures: string[] = [];
      for (const v of entries) {
        const o = await run(v);
        if (o.kind === "Unsupported") {
          // Only a locale outside the claimed set may be unsupported, and it must say so.
          const locale = localeOf(v.expr);
          const explained =
            locale !== undefined &&
            !SUPPORTED.has(locale) &&
            o.value.includes(`locale '${locale}'`);
          if (!explained)
            failures.push(`${v.mode}: ${v.expr} unexpectedly unsupported (${o.value})`);
        } else if (v.kind === "Invalid" && o.kind !== "Invalid") {
          failures.push(`${v.mode}: ${v.expr} reference invalid, ours ${o.kind}:${o.value}`);
        } else if (!agrees(v, o)) {
          failures.push(
            `${v.mode}: ${v.expr} reference ${v.kind}:${v.value}, ours ${o.kind}:${o.value}`,
          );
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("every supported locale vector is checked, and only other locales are unsupported", async () => {
    const localeVectors = fixture.entries.filter((e) => e.group.startsWith("locale-name"));
    let unsupported = 0;
    let checked = 0;
    for (const v of localeVectors) {
      const o = await run(v);
      const locale = localeOf(v.expr)!;
      if (SUPPORTED.has(locale)) {
        expect(o.kind, v.expr).not.toBe("Unsupported");
        checked++;
      } else {
        expect(o.kind, v.expr).toBe("Unsupported");
        unsupported++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(unsupported).toBeGreaterThan(100);
  });
});
