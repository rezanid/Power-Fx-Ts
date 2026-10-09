import { isApplicable, requiredHandlers, type CompatibilityProfile } from "./profile.js";
import type { TxtTestCase, TxtTestFile } from "./txt-format.js";

/** Outcome of running one expression in a candidate engine. */
export type RunResult =
  /** `text` is the compact serialized expression form (e.g. `Table({Value:1})`, `Blank()`). */
  | { readonly kind: "value"; readonly text: string }
  /** Compile errors, formatted like upstream (`Error 0-3: Invalid argument type...`). */
  | { readonly kind: "errors"; readonly errors: readonly string[] }
  | { readonly kind: "unsupported"; readonly reason: string };

export interface ExpressionRunner {
  /** Setup handlers this engine can provide; files needing others are reported as unsupported. */
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
      const missing = expectedErrors(expected).filter((e) => !actual.has(e));
      return missing.length === 0
        ? { ...base, outcome: "pass" }
        : { ...base, outcome: "fail", message: `Wrong errors: ${result.errors.join(" | ")}` };
    }
    return { ...base, outcome: "fail", message: `Unexpected errors: ${result.errors.join(" | ")}` };
  }
  return result.text === expected
    ? { ...base, outcome: "pass" }
    : { ...base, outcome: "fail", message: `Expected ${expected} but got ${result.text}` };
}

export async function runCompat(options: {
  readonly files: readonly TxtTestFile[];
  readonly profile: CompatibilityProfile;
  readonly runner: ExpressionRunner;
  readonly upstreamCommit: string;
}): Promise<CompatReport> {
  const { files, profile, runner, upstreamCommit } = options;
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
    const missing = requiredHandlers(file.setup).filter((h) => !runner.supportedHandlers.has(h));
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
