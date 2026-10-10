import { describe, expect, it } from "vitest";
import { Engine } from "../src/index.js";

// Cascaded diagnostics for out-of-range literals and combined operand errors (ADR 0011).
// Expected messages were produced by the pinned reference (tools/reference-harness `check`/`eval`).
const dec = new Engine({ numberMode: "decimal" });
const flt = new Engine();

const BIG = { decimal: "1E100", float: "1E400" } as const;
const TL = "Numeric value is too large.";
const IAT = "Invalid argument type. Expecting one of the following: ";
const ARITH = `${IAT}Number, Text, Boolean, Date, Time, DateTimeNoTimeZone, DateTime, Dynamic.`;
const NUM = `${IAT}Number, Text, Boolean, Dynamic.`;
const CONCAT = `${IAT}Text, GUID, Number, Date, Time, DateTimeNoTimeZone, DateTime, Boolean, ViewValue, Dynamic.`;
const BOOL = `${IAT}Boolean, Number, Text, Dynamic.`;
const PERCENT = `${IAT}Number, Date, DateTime, DateTimeNoTimeZone, Time, Text, Boolean, Dynamic.`;
const ORDER =
  "Invalid argument type. Expecting one of the following: Number, Decimal, Date, Time, DateTime, Dynamic.";
const CMP = (l: string, r: string) =>
  `Incompatible types for comparison. These types can't be compared: ${l}, ${r}.`;

function messages(e: Engine, formula: string): string[] {
  return e.check(formula).diagnostics.map((d) => `${d.span.start}-${d.span.end} ${d.message}`);
}

describe.each([
  ["decimal", dec],
  ["float", flt],
] as const)("%s profile", (mode, e) => {
  const L = BIG[mode];
  const at = (f: string, ...rest: string[]) => expect(messages(e, f)).toEqual(rest);

  it("reports each operator's accepted types for the Error operand", () => {
    at(`1 + ${L}`, `4-${4 + L.length} ${TL}`, `4-${4 + L.length} ${ARITH}`);
    at(`${L} * 2`, `0-${L.length} ${TL}`, `0-${L.length} ${ARITH}`);
    at(`1 - ${L}`, `4-${4 + L.length} ${TL}`, `4-${4 + L.length} ${NUM}`);
    at(`${L} - 1`, `0-${L.length} ${TL}`, `0-${L.length} ${ARITH}`);
    at(`${L} ^ 2`, `0-${L.length} ${TL}`, `0-${L.length} ${NUM}`);
    at(`-${L}`, `1-${1 + L.length} ${TL}`, `1-${1 + L.length} ${NUM}`);
    at(`!${L}`, `1-${1 + L.length} ${TL}`, `1-${1 + L.length} ${BOOL}`);
    at(`${L} && true`, `0-${L.length} ${TL}`, `0-${L.length} ${BOOL}`);
    at(`${L}%`, `0-${L.length} ${TL}`, `0-${L.length} ${PERCENT}`);
    at(`"a" & ${L}`, `6-${6 + L.length} ${TL}`, `6-${6 + L.length} ${CONCAT}`);
  });

  it("reports both Error operands independently", () => {
    const r = 8 + L.length;
    at(
      `${L} / ${L}`,
      `0-${L.length} ${TL}`,
      `${3 + L.length}-${r} ${TL}`,
      `0-${L.length} ${ARITH}`,
      `${3 + L.length}-${r} ${ARITH}`,
    );
  });

  it("reports ordering and equality shapes", () => {
    at(`1 < ${L}`, `4-${4 + L.length} ${TL}`, `4-${4 + L.length} ${ORDER}`);
    at(`${L} >= 1`, `0-${L.length} ${TL}`, `0-${L.length} ${ORDER}`);
    at(
      `${L} = 1`,
      `0-${L.length} ${TL}`,
      `${L.length + 1}-${L.length + 2} ${CMP("Error", "Number")}`,
    );
    at(`1 <> ${L}`, `5-${5 + L.length} ${TL}`, `2-4 ${CMP("Number", "Error")}`);
  });

  it("reports conversion calls on the call and the argument", () => {
    for (const fn of ["Value", "Decimal", "Float"]) {
      at(
        `${fn}(${L})`,
        `${fn.length + 1}-${fn.length + 1 + L.length} ${TL}`,
        `0-${fn.length} The function '${fn}' has some invalid arguments.`,
        `${fn.length + 1}-${fn.length + 1 + L.length} Expected text or number. We expect text or a number at this point in the formula.`,
      );
    }
    at(
      `Value("1", ${L})`,
      `11-${11 + L.length} ${TL}`,
      "0-5 The function 'Value' has some invalid arguments.",
      `11-${11 + L.length} Expected text. We expect text at this point in the formula.`,
    );
  });

  it("passes through groups, does not cascade through results, and leaves fields alone", () => {
    expect(messages(e, `(${L}) + 1`)).toContain(`1-${1 + L.length} ${ARITH}`);
    // The operator result is well typed, so the enclosing expression is clean.
    expect(messages(e, `(1 + ${L}) * 2`)).toHaveLength(2);
    at(`{a: ${L}}`, `4-${4 + L.length} ${TL}`);
  });

  it("never evaluates a formula that has a literal diagnostic", async () => {
    const r = await e.evaluate(`1 + ${L}`);
    expect(r.kind).toBe("invalid");
  });

  it("keeps valid formulas clean", () => {
    expect(e.check("1 + 2 * 3").diagnostics).toEqual([]);
  });
});

describe("combined operand errors (StandardErrorHandling)", () => {
  const big = "Decimal(340282366920938463463374607431768211456)";
  async function kinds(e: Engine, f: string): Promise<string[]> {
    const r = await e.evaluate(f);
    if (r.kind !== "value" || r.value.kind !== "Error") throw new Error(`not an error: ${f}`);
    return r.value.errors.map((x) => x.kind);
  }

  it("merges both operands' errors for eager operators", async () => {
    for (const op of ["/", "+", "-", "*", "^", "<", "=", "<>"]) {
      expect(await kinds(flt, `${big} ${op} ${big}`)).toEqual([
        "InvalidArgument",
        "InvalidArgument",
      ]);
    }
  });

  it("keeps a single error when only one operand fails", async () => {
    expect(await kinds(flt, `${big} + 1`)).toEqual(["InvalidArgument"]);
    expect(await kinds(flt, `1 + ${big}`)).toEqual(["InvalidArgument"]);
  });

  it("evaluates the right operand even when the left fails, but stays lazy for And/Or/If", async () => {
    expect(await kinds(flt, `1/0 + 1/0`)).toEqual(["Div0", "Div0"]);
    const r = await flt.evaluate("false && 1/0 > 0");
    expect(r.kind === "value" && r.value.kind === "Boolean").toBe(true);
  });

  it("returns frozen combined errors", async () => {
    const r = await flt.evaluate(`${big} + ${big}`);
    expect(r.kind === "value" && Object.isFrozen(r.value)).toBe(true);
  });
});
