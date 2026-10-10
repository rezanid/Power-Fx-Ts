import { describe, expect, it } from "vitest";
import { EvaluationBudgetExceeded } from "@powerfx-ts/interpreter";
import { loadRows, replayRows } from "./reference-probe.js";
import { Engine } from "../src/index.js";

// Differential tests for `Coalesce` (docs/adr/0012-coalesce.md). The three fixtures are the verbatim
// output of the pinned upstream C# implementation (tools/reference-harness `probe`):
//   dotnet run --project tools/reference-harness -- probe <float|decimal> \
//     packages/engine/test/fixtures/coalesce-probe.expressions.txt > coalesce-probe.<mode>.tsv
// Each row is `expression<TAB>static type<TAB>result`, where a result starting with `ERRORS:` lists
// the compile errors (`Error start-end: message`, `|`-separated) instead of a value.

const engines = { float: new Engine(), decimal: new Engine({ numberMode: "decimal" }) };

describe.each(["float", "decimal"] as const)("Coalesce matches the reference (%s)", (mode) => {
  replayRows(engines[mode], loadRows(`coalesce-probe.${mode}.tsv`));
});

describe("Coalesce evaluation contract", () => {
  const engine = new Engine();
  const steps = (text: string, maxSteps: number) =>
    new Engine({ maxSteps }).evaluate(text).then((r) => r.kind);

  it("does not evaluate (or charge for) arguments after the selected one", async () => {
    // `Coalesce(5, 1/0)`: literal 5 (1 node) + Call (1 node); the skipped `1/0` would add 3 more.
    expect(await steps("Coalesce(5, 1/0)", 2)).toBe("value");
    await expect(steps("Coalesce(5, 1/0)", 1)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
  });

  it("charges for every evaluated argument", async () => {
    // Call + Blank() + Blank() + 3 = 4 nodes... Blank() is a call node each.
    await expect(steps("Coalesce(Blank(), Blank(), 3)", 3)).rejects.toBeInstanceOf(
      EvaluationBudgetExceeded,
    );
    expect(await steps("Coalesce(Blank(), Blank(), 3)", 4)).toBe("value");
  });

  it("stops at a reached error without evaluating later arguments", async () => {
    await expect(steps("Coalesce(1/0, 2)", 3)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    expect(await steps("Coalesce(1/0, 2)", 4)).toBe("value");
    expect(await steps("Coalesce(1/0, 1/0, 1/0)", 4)).toBe("value");
  });

  describe.each(["float", "decimal"] as const)(
    "cancellation after evaluation begins (%s)",
    (mode) => {
      const eng = new Engine({ numberMode: mode });
      const reason = new Error("stop-now");
      // Structural signal that becomes aborted at the n-th check; counts every check made.
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
      const totalChecks = async (formula: string) => {
        const probe = signalAbortingAt(Number.MAX_SAFE_INTEGER);
        const r = await eng.evaluate(formula, { signal: probe.signal });
        expect(r.kind).toBe("value");
        return probe.state.checks;
      };

      for (const [label, formula] of [
        ["between arguments", "Coalesce(Blank(), Blank(), 1, 2)"],
        ["during table conformance", "Coalesce(If(false,[{a:1}]), [{b:2},{b:3},{b:4}])"],
      ] as const) {
        it(`propagates the reason and stops ${label}`, async () => {
          const total = await totalChecks(formula);
          expect(total).toBeGreaterThan(2);
          for (let n = 2; n <= total; n++) {
            const run = signalAbortingAt(n);
            await expect(eng.evaluate(formula, { signal: run.signal })).rejects.toBe(reason);
            expect(run.state.checks).toBe(n); // no check or evaluation after the abort
          }
        });
      }
    },
  );

  it("observes budget exhaustion while conforming table rows", async () => {
    const formula = "Coalesce(If(false,[{a:1}]), [{b:2},{b:3},{b:4}])";
    const needed = (() => {
      let n = 1;
      return async () => {
        while ((await steps(formula, n).catch(() => "budget")) === "budget") n++;
        return n;
      };
    })();
    const exact = await needed();
    await expect(steps(formula, exact - 1)).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
    // Conformance visits each of the 3 rows: an unconformed table needs fewer steps.
    expect(await steps("Coalesce(If(false,[{b:1}]), [{b:2},{b:3},{b:4}])", exact - 3)).toBe(
      "value",
    );
  });

  it("returns frozen results, including nested records and error arrays", async () => {
    const record = await engine.evaluate("Coalesce(If(false,{a:1}), {b:{c:2}})");
    if (record.kind !== "value" || record.value.kind !== "Record") throw new Error("record");
    expect(Object.isFrozen(record.value)).toBe(true);
    expect(Object.isFrozen(record.value.fields)).toBe(true);
    const nested = record.value.fields[1]!.value;
    expect(Object.isFrozen(nested)).toBe(true);

    const merged = await engine.evaluate('Coalesce(Blank(), (1/0)+(1+"x"), 1)');
    if (merged.kind !== "value" || merged.value.kind !== "Error") throw new Error("error");
    expect(merged.value.errors.map((e) => e.kind)).toEqual(["Div0", "InvalidArgument"]);
    expect(Object.isFrozen(merged.value)).toBe(true);
    expect(Object.isFrozen(merged.value.errors)).toBe(true);
    expect(merged.value.errors.every((e) => Object.isFrozen(e))).toBe(true);

    for (const mode of ["float", "decimal"] as const) {
      const decimal = await new Engine({ numberMode: mode }).evaluate(
        'Coalesce(Blank(), Decimal("1.5"), 1)',
      );
      if (decimal.kind !== "value" || decimal.value.kind !== "Decimal") throw new Error(mode);
      expect(Object.isFrozen(decimal.value)).toBe(true);
      expect(Object.isFrozen(decimal.value.value)).toBe(true);
    }
  });
});
