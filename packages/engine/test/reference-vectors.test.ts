import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/index.js";

// Differential tests: every vector was evaluated by the pinned upstream C# implementation
// (tools/reference-harness) in the named mode, and `direct` (where present) by System.Decimal itself.
// Regenerate with: dotnet run --project tools/reference-harness -- generate <this fixture>.
interface Vector {
  group: string;
  mode: "float" | "decimal";
  expr: string;
  kind: string;
  value: string;
  direct?: string;
  directAgrees?: boolean;
}
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/reference-vectors.json", import.meta.url), "utf8"),
) as { upstream: string; entries: Vector[] };

const engines = { float: new Engine(), decimal: new Engine({ numberMode: "decimal" }) };
const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function scaled(text: string): { m: bigint; s: number } {
  const m = DECIMAL_TEXT.exec(text);
  if (m === null) throw new Error(`not a decimal: ${text}`);
  const fraction = m[3] ?? "";
  const exponent = Number(m[4] ?? "0");
  return { m: BigInt(`${m[1]}${m[2]}${fraction}` || "0"), s: fraction.length - exponent };
}
function sameDecimal(a: string, b: string): boolean {
  const x = scaled(a);
  const y = scaled(b);
  const c = Math.max(x.s, y.s);
  return x.m * 10n ** BigInt(c - x.s) === y.m * 10n ** BigInt(c - y.s);
}

/** Doubles from `^` may differ in the last bits: V8's Math.pow is not .NET's Math.Pow. */
const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 4e-16 * Math.abs(b);

async function mismatch(v: Vector): Promise<string | undefined> {
  const engine = engines[v.mode];
  const r = await engine.evaluate(v.expr);
  let kind: string;
  let value = "";
  if (r.kind === "invalid") kind = "Invalid";
  else if (r.kind === "unsupported") kind = `Unsupported(${r.features.map((f) => f.feature)})`;
  else {
    const x = r.value;
    kind = x.kind;
    if (x.kind === "Decimal") value = engine.formatDecimal(x.value);
    else if (x.kind === "Number") value = engine.formatNumber(x.value);
    else if (x.kind === "Error") value = x.errors[0]?.kind ?? "";
    else if (x.kind === "Text") value = x.value;
    else if (x.kind === "Boolean") value = String(x.value);
  }
  const same =
    kind === v.kind &&
    (kind === "Invalid" ||
      kind === "Blank" ||
      (kind === "Decimal" && sameDecimal(v.value, value)) ||
      (kind === "Number" &&
        (Number(v.value) === Number(value) ||
          (v.expr.includes("^") && nearlyEqual(Number(value), Number(v.value))))) ||
      (["Error", "Text", "Boolean"].includes(kind) && v.value === value));
  return same
    ? undefined
    : `${v.mode}: ${v.expr} reference ${v.kind}:${v.value}, ours ${kind}:${value}`;
}

const groups = Map.groupBy(fixture.entries, (e) => e.group);

describe("differential tests against the pinned C# reference", () => {
  it("pins the upstream commit and covers every category", () => {
    expect(fixture.upstream).toBe("df4ceba5e08220db670c25afead342ce699c50b5");
    for (const g of [
      "literal-rounding",
      "arith-+",
      "arith--",
      "arith-*",
      "arith-/",
      "random-+",
      "random-/",
      "random-decimal-to-float",
      "float-to-decimal",
      "decimal-to-float",
      "mixed-arith",
      "mixed-compare",
      "mixed-unary",
      "mixed-conv",
      "mixed-if",
    ]) {
      expect(groups.get(g)?.length ?? 0, g).toBeGreaterThan(5);
    }
    expect(fixture.entries.length).toBeGreaterThan(4000);
  });

  it("the reference itself agrees with System.Decimal on every cross-checked vector", () => {
    const checked = fixture.entries.filter((e) => e.directAgrees !== undefined);
    expect(checked.length).toBeGreaterThan(2500);
    expect(checked.filter((e) => e.directAgrees === false)).toEqual([]);
  });

  it("covers the overflow boundary in both directions", () => {
    const arith = fixture.entries.filter((e) => e.group.startsWith("arith-"));
    expect(arith.some((e) => e.kind === "Error" && e.value === "Numeric")).toBe(true);
    expect(arith.some((e) => e.kind === "Error" && e.value === "Div0")).toBe(true);
    expect(arith.some((e) => e.kind === "Decimal" && e.value.length >= 30)).toBe(true);
  });

  for (const [group, entries] of groups) {
    it(`${group}: ${entries.length} vectors match`, async () => {
      const failures: string[] = [];
      for (const entry of entries) {
        const m = await mismatch(entry);
        if (m !== undefined) failures.push(m);
      }
      expect(failures).toEqual([]);
    });
  }
});
