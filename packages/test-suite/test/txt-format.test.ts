import { describe, expect, it } from "vitest";
import {
  PROFILES,
  compareResult,
  isApplicable,
  parseSetupString,
  parseTxtTestFile,
  requiredHandlers,
  runCompat,
  unsupportedRunner,
} from "../src/index.js";

const sample = `\uFEFF#SETUP: PowerFxV1,disable:NumberIsFloat // comment
#SETUP: AllEnumsSetup

// comment
>> Abs(-2)
2

>> If(
  true,
  1)
1

#DISABLE.NET:70
>> 1/0
Error({Kind:ErrorKind.Div0})
`;

const v1 = PROFILES["v1-decimal"]!;

describe("txt format", () => {
  it("parses directives and cases", () => {
    const file = parseTxtTestFile("Sample.txt", sample);
    expect(file.setup["PowerFxV1"]).toBe(true);
    expect(file.setup["NumberIsFloat"]).toBe(false);
    expect(file.setup["PowerFxV1CompatibilityRules"]).toBe(true);
    expect(file.cases.map((c) => [c.line, c.input, c.expected])).toEqual([
      [5, "Abs(-2)", "2"],
      [8, "If(\n  true,\n  1)", "1"],
      [14, "1/0", "Error({Kind:ErrorKind.Div0})"],
    ]);
    expect(requiredHandlers(file.setup)).toEqual(["AllEnumsSetup"]);
  });

  it("tolerates repeated BOMs", () => {
    expect(parseTxtTestFile("b.txt", "\uFEFF\uFEFF>> 1\n1").cases).toHaveLength(1);
  });

  it("rejects contradictory setup", () => {
    expect(() =>
      parseTxtTestFile("x.txt", "#SETUP: NumberIsFloat\n#SETUP: disable:NumberIsFloat"),
    ).toThrow(/contradictory/);
  });

  it("selects files by profile", () => {
    expect(isApplicable(parseSetupString("NumberIsFloat"), v1)).toBe(false);
    expect(isApplicable(parseSetupString("disable:NumberIsFloat"), v1)).toBe(true);
    expect(isApplicable(parseSetupString('TimeZoneInfo("UTC")'), v1)).toBe(true);
  });

  it("compares results", () => {
    const c = {
      file: "f",
      line: 1,
      input: "1",
      expected: "Errors: Error 0-1: Bad|Error 2-3: Worse",
    };
    const errors = { kind: "errors", errors: ["Error 0-1: Bad", "Error 2-3: Worse"] } as const;
    expect(compareResult(c, errors).outcome).toBe("pass");
    expect(compareResult(c, { kind: "value", text: "1" }).outcome).toBe("fail");
    expect(compareResult({ ...c, expected: "#SKIP" }, errors).outcome).toBe("skip");
  });

  it("reports unsupported for the placeholder engine", async () => {
    const report = await runCompat({
      files: [parseTxtTestFile("Sample.txt", sample)],
      profile: v1,
      runner: unsupportedRunner,
      upstreamCommit: "test",
    });
    expect(report.totals.cases).toBe(3);
    expect(report.totals.unsupported).toBe(3);
  });
});
