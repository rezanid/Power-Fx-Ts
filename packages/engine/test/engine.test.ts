import { describe, expect, it } from "vitest";
import {
  EvaluationBudgetExceeded,
  formatDouble,
  missingImplementations,
  type FormulaValue,
} from "@powerfx-ts/interpreter";
import { Engine } from "../src/index.js";

const engine = new Engine();

function show(value: FormulaValue): string {
  switch (value.kind) {
    case "Blank":
      return "Blank()";
    case "Boolean":
      return String(value.value);
    case "Text":
      return JSON.stringify(value.value);
    case "Number":
      return engine.formatNumber(value.value);
    case "Record":
      return `{${value.fields.map((f) => `${f.name}:${show(f.value)}`).join(",")}}`;
    case "Error":
      return `Error:${value.errors[0]?.kind}`;
  }
}

async function run(formula: string): Promise<string> {
  const result = await engine.evaluate(formula);
  if (result.kind === "value") return show(result.value);
  if (result.kind === "invalid") return `invalid:${result.diagnostics.map((d) => d.message)[0]}`;
  return `unsupported:${result.features.map((f) => f.feature).join(",")}`;
}

describe("literals and arithmetic", () => {
  it.each([
    ["1+2*3", "7"],
    ["(1+2)*3", "9"],
    ["2^10", "1024"],
    ["-5+2", "-3"],
    ["50%", "0.5"],
    ["7/2", "3.5"],
    ["0.1+0.2", "0.30000000000000004"],
    ['"a"&"b"&1', '"ab1"'],
    ["1/0", "Error:Div0"],
  ])("%s -> %s", async (formula, expected) => {
    expect(await run(formula)).toBe(expected);
  });
});

describe("coercion and Blank", () => {
  it.each([
    ['"3"*"4"', "12"],
    ['"x"*3', "Error:InvalidArgument"],
    ["Blank()-5", "-5"],
    ["5/Blank()", "Error:Div0"],
    ["Blank()=Blank()", "true"],
    ["Blank()=0", "false"],
    ['""=Blank()', "false"],
    ["If(false,1)", "Blank()"],
    ['If(false,"a",Blank())', "Blank()"],
    ["IsBlank(Blank())", "true"],
    ['IsBlank("")', "true"],
  ])("%s -> %s", async (formula, expected) => {
    expect(await run(formula)).toBe(expected);
  });

  it("compares text case-insensitively", async () => {
    expect(await run('"ABC"="abc"')).toBe("true");
    expect(await run('"a"<>"b"')).toBe("true");
  });
});

describe("If and short-circuiting", () => {
  it("only evaluates the selected branch", async () => {
    expect(await run("If(true, 1, 1/0)")).toBe("1");
    expect(await run("If(false, 1/0, 2)")).toBe("2");
  });

  it("supports multiple condition/result pairs and else", async () => {
    expect(await run("If(1>2,1,2>3,2,3)")).toBe("3");
    expect(await run("If(1>2,1,3>2,2,3)")).toBe("2");
  });

  it("short-circuits && and ||", async () => {
    expect(await run("false && (1/0 > 1)")).toBe("false");
    expect(await run("true || (1/0 > 1)")).toBe("true");
  });
});

describe("binding diagnostics", () => {
  it("rejects mismatched equality types at the operator span", async () => {
    const result = await engine.evaluate('1 = "1"');
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.diagnostics[0]).toMatchObject({
      message: "Incompatible types for comparison. These types can't be compared: Number, Text.",
      span: { start: 2, end: 3 },
    });
  });

  it("rejects ordering on Boolean operands", async () => {
    expect(await run("true < 1")).toMatch(/^invalid:Invalid argument type/);
  });

  it("reports unknown names as errors", async () => {
    expect(await run("x + 1")).toBe("invalid:Name isn't valid. 'x' isn't recognized.");
  });

  it("reports unimplemented functions as unsupported, not as errors", async () => {
    expect(await run("Sum(1,2)")).toMatch(/^unsupported:/);
  });
});

describe("evaluation boundary", () => {
  it("registers an implementation for every builtin signature", () => {
    expect(missingImplementations()).toEqual([]);
  });

  it("rejects when the signal is already aborted", async () => {
    const reason = new Error("stop");
    const signal = {
      aborted: true,
      throwIfAborted() {
        throw reason;
      },
    };
    await expect(engine.evaluate("1+2", { signal })).rejects.toBe(reason);
  });

  it("enforces the step budget", async () => {
    const small = new Engine({ maxSteps: 3 });
    await expect(small.evaluate("1+2+3+4+5")).rejects.toBeInstanceOf(EvaluationBudgetExceeded);
  });
});

describe("unsupported versus invalid", () => {
  const kind = async (text: string) => (await engine.evaluate(text)).kind;

  it("treats a known upstream function without an implementation as unsupported", async () => {
    expect(await kind("Sum(1, 2)")).toBe("unsupported");
  });

  it("reports a name upstream does not know as an invalid-expression error", async () => {
    const r = await engine.evaluate('Wyz("foo")');
    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") {
      expect(r.diagnostics[0]?.message).toBe("'Wyz' is an unknown or unsupported function.");
      expect(r.diagnostics[0]?.span).toEqual({ start: 0, end: 10 });
    }
  });

  it("reports syntax errors even when unimplemented constructs are also present", async () => {
    expect(await kind("Sum(1, 2) +")).toBe("invalid");
  });

  it("marks valid upstream syntax the parser lacks as unsupported", async () => {
    expect(await kind('$"x {1}"')).toBe("unsupported");
    expect(await kind("Sum(T As x)")).toBe("unsupported");
  });

  it.each(['Sum(1,, 2) + $"x"', "1 + ) As x", "Sum(1,", "Sum(1; 2)"])(
    "does not let unsupported-syntax detection hide a syntax error before it in %s",
    async (text) => {
      expect((await engine.evaluate(text)).kind).toBe("invalid");
    },
  );

  it("cannot judge malformed text after unsupported syntax, so it stays unsupported", async () => {
    expect((await engine.evaluate('$"x" + (')).kind).toBe("unsupported");
  });

  it("reports `;` without chaining as operator-expected, like upstream", () => {
    const codes = engine.check("Text(1,89; 2)").diagnostics.map((d) => d.code);
    expect(codes).toContain("PFX1002");
  });

  it("accepts a trailing comma in table literals like upstream", () => {
    expect(engine.check("[1, 2,]").diagnostics).toEqual([]);
  });
});

describe("ordering operators check each operand independently", () => {
  it.each([
    ["1 < 2", 0],
    ["Blank() < 1", 0],
    ['1 < "2"', 1],
    ['"1" < 2', 1],
    ['"a" < "b"', 2],
    ["true < 1", 1],
    ["1 >= false", 1],
  ])("%s -> %i diagnostics", (text, count) => {
    expect(engine.check(text).diagnostics.length).toBe(count);
  });
});

describe("formatDouble", () => {
  it.each([
    [0, "0"],
    [-0, "0"],
    [1e15, "1E+15"],
    [123456789012345, "123456789012345"],
    [1e-5, "0.00001"],
    [1e-6, "1E-06"],
    [2e100, "2E+100"],
    [0.1 + 0.2, "0.30000000000000004"],
  ])("%s -> %s", (n, expected) => {
    expect(formatDouble(n)).toBe(expected);
  });
});
