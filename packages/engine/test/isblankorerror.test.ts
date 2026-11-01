import { describe, expect, it } from "vitest";
import { EvaluationBudgetExceeded } from "@powerfx-ts/interpreter";
import { loadRows, replayRows } from "./reference-probe.js";
import { Engine } from "../src/index.js";

describe.each(["float", "decimal"] as const)(
  "IsBlankOrError matches the reference (%s)",
  (mode) => {
    const engine = new Engine({ numberMode: mode });

    replayRows(engine, loadRows(`isblankorerror-probe.${mode}.tsv`));

    it("returns frozen Booleans", async () => {
      const result = await engine.evaluate("IsBlankOrError(Blank())");
      if (result.kind !== "value" || result.value.kind !== "Boolean") {
        throw new Error("expected a Boolean value");
      }
      expect(Object.isFrozen(result.value)).toBe(true);
    });

    it("charges for the call and evaluated argument, but not a skipped If branch", async () => {
      const formula = 'IsBlankOrError(If(false, "not visited"))';
      await expect(
        new Engine({ numberMode: mode, maxSteps: 2 }).evaluate(formula),
      ).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
      const result = await new Engine({ numberMode: mode, maxSteps: 3 }).evaluate(formula);
      expect(result.kind).toBe("value");
    });

    it("observes cancellation during evaluation", async () => {
      const formula = 'IsBlankOrError(If(false, "not visited"))';
      const signalAbortingAt = (n: number) => {
        const state = { checks: 0 };
        const reason = new Error("stop-now");
        return {
          state,
          reason,
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
      const probe = signalAbortingAt(Number.MAX_SAFE_INTEGER);
      const result = await engine.evaluate(formula, { signal: probe.signal });
      expect(result.kind).toBe("value");
      for (let n = 2; n <= probe.state.checks; n++) {
        const cancelled = signalAbortingAt(n);
        await expect(engine.evaluate(formula, { signal: cancelled.signal })).rejects.toBe(
          cancelled.reason,
        );
        expect(cancelled.state.checks).toBe(n);
      }
    });
  },
);
