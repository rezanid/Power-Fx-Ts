import { describe, expect, it } from "vitest";
import { Engine } from "../src/index.js";
import { loadRows, replayRows } from "./reference-probe.js";

describe.each(["float", "decimal"] as const)(
  "scalar text functions match the reference (%s)",
  (mode) => {
    const engine = new Engine({ numberMode: mode });

    replayRows(engine, loadRows(`scalar-text-probe.${mode}.tsv`));

    it("reports precise and generic diagnostics for non-scalar arguments", () => {
      const checked = engine.check('Lower({a:"x"})');
      expect(checked.ok).toBe(false);
      expect(
        checked.diagnostics.map(
          (diagnostic) =>
            `Error ${diagnostic.span.start}-${diagnostic.span.end}: ${diagnostic.message}`,
        ),
      ).toEqual([
        "Error 6-13: Invalid argument type (Record). Expecting a Text value instead.",
        "Error 0-5: The function 'Lower' has some invalid arguments.",
      ]);
    });

    it("keeps table overloads explicitly unsupported", () => {
      const checked = engine.check('Len([{Value:"x"}])');
      expect(checked.ok).toBe(false);
      expect(checked.diagnostics).toEqual([]);
      expect(checked.unsupported.map((feature) => feature.feature)).toEqual(["Len table overload"]);
    });

    it("preserves unpaired UTF-16 surrogates during casing", async () => {
      const loneSurrogate = String.fromCharCode(0xd800);
      const formula = `Lower("${loneSurrogate}")`;
      const result = await engine.evaluate(formula);
      if (result.kind !== "value" || result.value.kind !== "Text") {
        throw new Error("expected a text value");
      }
      expect(result.value.value).toBe(loneSurrogate);
    });
  },
);
