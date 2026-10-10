import { describe, expect, it } from "vitest";
import { EvaluationBudgetExceeded, type FormulaValue } from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";

// ADR 0013 (option B): empty text coerced to Number/Decimal/Boolean in `If` results, table
// literals and `Table(...)` is Blank. The fixtures are verbatim pinned-reference output:
//   dotnet run --project tools/reference-harness -- probe <float|decimal> \
//     packages/engine/test/fixtures/empty-text.expressions.txt > empty-text.<mode>.tsv
// (45 `If`/array probes, 28 `Table(...)`/nested-table probes, 9 consumer guards that must not change).

const modes = ["float", "decimal"] as const;

describe.each(modes)("empty-text coercion matches the reference (%s)", (mode) => {
  replayRows(new Engine({ numberMode: mode }), loadRows(`empty-text.${mode}.tsv`));
});

function isDeepFrozen(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return true;
  if (!Object.isFrozen(v)) return false;
  return Object.values(v as Record<string, unknown>).every(isDeepFrozen);
}

describe.each(modes)("evaluation contract (%s)", (mode) => {
  const engine = new Engine({ numberMode: mode });
  /** Smallest step budget under which the formula evaluates. */
  const minSteps = async (formula: string): Promise<number> => {
    for (let n = 1; n < 500; n++) {
      try {
        const r = await new Engine({ numberMode: mode, maxSteps: n }).evaluate(formula);
        if (r.kind === "value") return n;
      } catch (e) {
        if (!(e instanceof EvaluationBudgetExceeded)) throw e;
      }
    }
    throw new Error(`no budget found for ${formula}`);
  };
  const budgetError = (formula: string, n: number) =>
    expect(new Engine({ numberMode: mode, maxSteps: n }).evaluate(formula)).rejects.toBeInstanceOf(
      EvaluationBudgetExceeded,
    );

  it("skipped If branches execute nothing and consume no budget", async () => {
    const cheap = await minSteps("If(true, 1, 2)");
    // Skipped: an error, a conformed table, a coerced text, a conformed record.
    for (const skipped of [
      "1/0",
      'CountRows([{a:1},{a:""},{a:""},{a:""}])',
      '"" & "x"',
      'If(false, 1, "")',
    ]) {
      expect(await minSteps(`If(true, 1, ${skipped})`), skipped).toBe(cheap);
    }
    const r = await engine.evaluate("If(true, 1, 1/0)");
    expect(r.kind === "value" && r.value.kind).not.toBe("Error");
    // A skipped aggregate branch (and its conformance) is free as well.
    expect(await minSteps('If(true,[{a:1}],[{a:""},{a:""},{a:""}])')).toBe(
      await minSteps("If(true,[{a:1}],[{a:2}])"),
    );
  });

  it("downstream lazy consumers skip errors and skipped conformance", async () => {
    // `Coalesce` stops at the first value; the later `If`/table arguments are never evaluated.
    const base = await minSteps("Coalesce(5, 2)");
    for (const skipped of ['If(false, 1, "")', 'CountRows([{a:1},{a:""}])', "1/0"]) {
      expect(await minSteps(`Coalesce(5, ${skipped})`), skipped).toBe(base);
    }
    // A reached error in a table literal row is preserved and the surrounding rows still conform.
    const r = await engine.evaluate('[{a:1},{a:1/0},{a:""}]');
    if (r.kind !== "value" || r.value.kind !== "Table") throw new Error("table");
    expect(
      r.value.rows.map((row) => (row.kind === "Record" ? row.fields[0]!.value.kind : "?")),
    ).toEqual([mode === "float" ? "Number" : "Decimal", "Error", "Blank"]);
  });

  it("charges for scalar coercion and for every conformed row", async () => {
    const scalar = await minSteps('If(false, 1, "")');
    await budgetError('If(false, 1, "")', scalar - 1);
    const small = await minSteps('Table({a:1},{a:""})');
    const large = await minSteps('Table({a:1},{a:""},{a:""},{a:""})');
    expect(large).toBeGreaterThan(small);
    await budgetError('Table({a:1},{a:""},{a:""},{a:""})', large - 1);
    const nestedSmall = await minSteps('[{a:[{b:1}]},{a:[{b:""}]}]');
    const nestedLarge = await minSteps('[{a:[{b:1}]},{a:[{b:""},{b:""},{b:""}]}]');
    expect(nestedLarge).toBeGreaterThan(nestedSmall);
    await budgetError('[{a:[{b:1}]},{a:[{b:""},{b:""},{b:""}]}]', nestedLarge - 1);
    const agg = await minSteps('If(false,[{a:1}],[{a:""},{a:""},{a:""}])');
    await budgetError('If(false,[{a:1}],[{a:""},{a:""},{a:""}])', agg - 1);
  });

  describe("cancellation after evaluation begins", () => {
    const reason = new Error("stop-now");
    // Structural signal that is aborted from the n-th check on; counts every check made.
    const signalAbortingAt = (n: number) => {
      const state = { checks: 0 };
      return {
        state,
        signal: {
          get aborted() {
            return state.checks >= n;
          },
          throwIfAborted() {
            state.checks++;
            if (state.checks >= n) throw reason;
          },
        },
      };
    };
    for (const [label, formula] of [
      ["scalar If result coercion", 'If(false, 1, "")'],
      ["aggregate If conformance", 'If(false,[{a:1}],[{a:""},{a:""}])'],
      ["table literal conformance", '[{a:1},{a:""},{a:""}]'],
      ["Table(...) conformance", 'Table({a:1},[{a:""},{a:""}])'],
      ["nested table field conformance", '[{a:[{b:1}]},{a:[{b:""}]}]'],
    ] as const) {
      it(`propagates the reason and stops: ${label}`, async () => {
        const probe = signalAbortingAt(Number.MAX_SAFE_INTEGER);
        const done = await engine.evaluate(formula, { signal: probe.signal });
        expect(done.kind).toBe("value");
        const total = probe.state.checks;
        expect(total).toBeGreaterThan(2);
        for (let n = 2; n <= total; n++) {
          const run = signalAbortingAt(n);
          await expect(engine.evaluate(formula, { signal: run.signal })).rejects.toBe(reason);
          expect(run.state.checks).toBe(n);
        }
      });
    }
  });

  it("returns recursively frozen results, error arrays and Decimal payloads", async () => {
    for (const formula of [
      'If(false, 1, "")',
      'If(false,{a:[{b:1}]},{a:[{b:""}]})',
      '[{a:Decimal("1.5")},{a:""},{a:Decimal("2")}]',
      'Table({a:1},{a:"x"},{a:""})',
      '[{a:1},{a:(1/0)+(1+"x")},{a:""}]',
    ]) {
      const r = await engine.evaluate(formula);
      if (r.kind !== "value") throw new Error(formula);
      expect(isDeepFrozen(r.value), formula).toBe(true);
    }
    const dec = await engine.evaluate('[{a:Decimal("1.5")},{a:""}]');
    const first = (
      dec.kind === "value" && dec.value.kind === "Table" ? dec.value.rows[0] : undefined
    ) as { fields: { value: FormulaValue }[] } | undefined;
    expect(first?.fields[0]?.value.kind).toBe("Decimal");
  });
});
