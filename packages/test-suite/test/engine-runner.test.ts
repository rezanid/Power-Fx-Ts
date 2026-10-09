import { Engine } from "@powerfx-ts/engine";
import { describe, expect, it } from "vitest";
import {
  PROFILES,
  compareResult,
  createEngineRunner,
  numbersClose,
  runCompat,
  type TxtTestFile,
} from "../src/index.js";

const profile = PROFILES["v1-float"]!;
const at = (input: string, expected: string) => ({ file: "t.txt", line: 1, input, expected });

describe("compareResult rules mirrored from upstream BaseRunner", () => {
  it("accepts float text within upstream's tolerance only for numbers", () => {
    expect(numbersClose("2E100", "2E+100")).toBe(true);
    expect(numbersClose("1", "1.000001")).toBe(true);
    expect(numbersClose("1", "1.1")).toBe(false);
    expect(numbersClose('"1"', '"1"')).toBe(false);
    expect(compareResult(at("x", "2E100"), { kind: "value", text: "2E+100" }).outcome).toBe("pass");
    expect(compareResult(at("x", "3"), { kind: "value", text: "4" }).outcome).toBe("fail");
  });

  it("treats Decimal in expected error text as Number", () => {
    const expected =
      "Errors: Error 2-3: Incompatible types for comparison. These types can't be compared: Decimal, Text.";
    const actual =
      "Error 2-3: Incompatible types for comparison. These types can't be compared: Number, Text.";
    expect(compareResult(at("x", expected), { kind: "errors", errors: [actual] }).outcome).toBe(
      "pass",
    );
  });

  it("accepts extra actual errors like upstream but flags them strictly", () => {
    const r = compareResult(at("x", "Errors: Error 0-1: A."), {
      kind: "errors",
      errors: ["Error 0-1: A.", "Error 2-3: B."],
    });
    expect(r.outcome).toBe("pass");
    expect(r.strictErrors).toBe("differs");
  });

  it("fails when an expected error is missing", () => {
    expect(
      compareResult(at("x", "Errors: Error 0-1: A."), { kind: "errors", errors: ["Error 0-1: C."] })
        .outcome,
    ).toBe("fail");
  });

  it("keeps | inside quoted text with the greedy upstream split", () => {
    const e = 'Errors: Error 0-1: say "a|b" now.|Error 2-3: B.';
    const r = compareResult(at("x", e), {
      kind: "errors",
      errors: ['Error 0-1: say "a|b" now.', "Error 2-3: B."],
    });
    expect(r.outcome).toBe("pass");
  });

  it("rejects a fuzzy float match against a >17 digit decimal expectation", () => {
    const r = compareResult(at("x", "0.12345678901234567891"), {
      kind: "value",
      text: "0.12345678901234568",
    });
    expect(r.outcome).toBe("fail");
  });

  it("never passes an unsupported result", () => {
    expect(
      compareResult(at("x", "1"), { kind: "unsupported", category: "feature", reason: "r" })
        .outcome,
    ).toBe("unsupported");
  });
});

describe("engine runner end to end", () => {
  const file = (cases: [string, string][]): TxtTestFile => ({
    file: "mem/Slice.txt",
    setup: {},
    disables: [],
    override: undefined,
    cases: cases.map(([input, expected], i) => ({
      file: "mem/Slice.txt",
      line: i + 1,
      input,
      expected,
    })),
  });

  it("reports real passes, failures and unsupported without hard-coding", async () => {
    const report = await runCompat({
      files: [
        file([
          ["1+1", "2"],
          ["1+1", "3"],
          ["Sum(1)", "1"],
          ["1 < true", "Errors: Error 0-1: wrong"],
        ]),
      ],
      profile,
      runner: createEngineRunner(new Engine()),
      runnerName: "engine",
      upstreamCommit: "test",
    });
    expect(report.totals).toMatchObject({ pass: 1, fail: 2, unsupported: 1 });
  });

  it("is unsupported for a profile with a different number mode", async () => {
    const result = await createEngineRunner().run("1", PROFILES["v1-decimal"]!);
    expect(result.kind).toBe("unsupported");
  });
});
