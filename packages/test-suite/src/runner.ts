import { isApplicable, requiredSetup, type CompatibilityProfile } from "./profile.js";
import type { TxtTestCase, TxtTestFile } from "./txt-format.js";

/** Outcome of running one expression in a candidate engine. */
export type RunResult =
  /** `text` is the compact serialized expression form (e.g. `Table({Value:1})`, `Blank()`). */
  | { readonly kind: "value"; readonly text: string }
  /** Compile errors, formatted like upstream (`Error 0-3: Invalid argument type...`). */
  | { readonly kind: "errors"; readonly errors: readonly string[] }
  | { readonly kind: "unsupported"; readonly reason: string };

export interface ExpressionRunner {
  /**
   * File-level `#SETUP:` names (handlers and parser flags, without arguments) this engine honors.
   * Files requiring any other enabled setup are reported as unsupported, never run.
   */
  readonly supportedHandlers: ReadonlySet<string>;
  run(input: string, profile: CompatibilityProfile): Promise<RunResult>;
}

export type CaseOutcome = "pass" | "fail" | "skip" | "unsupported";

export interface CaseResult {
  readonly file: string;
  readonly line: number;
  readonly outcome: CaseOutcome;
  readonly message?: string;
}

export interface FileSummary {
  readonly file: string;
  readonly total: number;
  readonly applicable: boolean;
  readonly counts: Readonly<Record<CaseOutcome, number>>;
}

export interface CompatReport {
  readonly upstreamCommit: string;
  readonly runner: string;
  readonly profile: string;
  readonly setupString: string;
  readonly numberMode: string;
  readonly culture: string;
  readonly timeZone: string;
  readonly totals: Readonly<Record<CaseOutcome, number>> & {
    readonly cases: number;
    readonly inapplicable: number;
  };
  readonly files: readonly FileSummary[];
  readonly failures: readonly CaseResult[];
}

const emptyCounts = (): Record<CaseOutcome, number> => ({
  pass: 0,
  fail: 0,
  skip: 0,
  unsupported: 0,
});

function expectedErrors(expected: string): string[] {
  const body = expected.replace("Errors: ", "");
  return (body.match(/("[^"]*"|[^|])+/g) ?? []).map((s) => s.trim());
}

export function compareResult(testCase: TxtTestCase, result: RunResult): CaseResult {
  const base = { file: testCase.file, line: testCase.line };
  const expected = testCase.expected;
  if (/^\s*#skip/i.test(expected)) return { ...base, outcome: "skip", message: "#SKIP" };
  if (result.kind === "unsupported") {
    return { ...base, outcome: "unsupported", message: result.reason };
  }
  if (result.kind === "errors") {
    if (/^Errors: (Error|Warning)/.test(expected)) {
      const actual = new Set(result.errors);
      const wanted = new Set(expectedErrors(expected));
      // Upstream accepts expected messages naming Decimal when a Number-only engine reports Number.
      const matches = (e: string): boolean =>
        actual.has(e) || decimalAsNumberVariants(e).some((v) => actual.has(v));
      const missing = [...wanted].filter((e) => !matches(e));
      const extra = [...actual].filter(
        (a) => ![...wanted].some((w) => w === a || decimalAsNumberVariants(w).includes(a)),
      );
      return missing.length === 0 && extra.length === 0
        ? { ...base, outcome: "pass" }
        : { ...base, outcome: "fail", message: `Wrong errors: ${result.errors.join(" | ")}` };
    }
    return { ...base, outcome: "fail", message: `Unexpected errors: ${result.errors.join(" | ")}` };
  }
  return result.text === expected || numbersClose(expected, result.text)
    ? { ...base, outcome: "pass" }
    : { ...base, outcome: "fail", message: `Expected ${expected} but got ${result.text}` };
}

function decimalAsNumberVariants(exp: string): string[] {
  return [
    exp.replace(/( Decimal, Number, | Number, Decimal, | Decimal, (?!Number))/g, " Number, "),
    exp.replace(/(['(])Decimal([')])/g, "$1Number$2"),
    exp.replace(/ Decimal( value|\.)/g, " Number$1"),
  ];
}

const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Mirrors upstream BaseRunner.NumberCompare: absolute 1e-5 or relative 1e-14 tolerance. */
export function numbersClose(expected: string, actual: string): boolean {
  if (!NUMBER_TEXT.test(expected) || !NUMBER_TEXT.test(actual)) return false;
  const b = Number(expected);
  const a = Number(actual);
  const diff = Math.abs(a - b);
  return diff < 1e-5 || (b !== 0 && Math.abs(diff / b) < 1e-14);
}

export async function runCompat(options: {
  readonly files: readonly TxtTestFile[];
  readonly profile: CompatibilityProfile;
  readonly runner: ExpressionRunner;
  readonly runnerName: string;
  readonly upstreamCommit: string;
}): Promise<CompatReport> {
  const { files, profile, runner, runnerName, upstreamCommit } = options;
  const totals = { ...emptyCounts(), cases: 0, inapplicable: 0 };
  const summaries: FileSummary[] = [];
  const failures: CaseResult[] = [];
  const disabled = new Set(files.flatMap((f) => f.disables.map((d) => d.toLowerCase())));

  for (const file of files) {
    const fileName = file.file.split("/").pop() ?? file.file;
    totals.cases += file.cases.length;
    if (disabled.has(fileName.toLowerCase()) || !isApplicable(file.setup, profile)) {
      totals.inapplicable += file.cases.length;
      summaries.push({
        file: file.file,
        total: file.cases.length,
        applicable: false,
        counts: emptyCounts(),
      });
      continue;
    }
    const missing = requiredSetup(file.setup, profile).filter(
      (name) => !runner.supportedHandlers.has(name),
    );
    const counts = emptyCounts();
    for (const testCase of file.cases) {
      let result: CaseResult;
      if (missing.length > 0) {
        result = {
          file: file.file,
          line: testCase.line,
          outcome: "unsupported",
          message: `Setup handler not available: ${missing.join(", ")}`,
        };
      } else {
        try {
          result = compareResult(testCase, await runner.run(testCase.input, profile));
        } catch (error) {
          result = {
            file: file.file,
            line: testCase.line,
            outcome: "fail",
            message: `Threw: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      counts[result.outcome]++;
      totals[result.outcome]++;
      if (result.outcome === "fail") failures.push(result);
    }
    summaries.push({ file: file.file, total: file.cases.length, applicable: true, counts });
  }

  return {
    upstreamCommit,
    runner: runnerName,
    profile: profile.name,
    setupString: profile.setupString,
    numberMode: profile.numberMode,
    culture: profile.culture,
    timeZone: profile.timeZone,
    totals,
    files: summaries,
    failures,
  };
}

/** Placeholder engine used until the TypeScript engine exists: everything is unsupported. */
export const unsupportedRunner: ExpressionRunner = {
  supportedHandlers: new Set(),
  run: () => Promise.resolve({ kind: "unsupported", reason: "engine not implemented" }),
};
