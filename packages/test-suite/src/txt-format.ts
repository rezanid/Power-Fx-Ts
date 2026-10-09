/**
 * Reader for the upstream Power Fx expression-test `.txt` format.
 * See upstream `ExpressionTestCases/README.md` and `TestRunner.AddFile`.
 */

export type SetupSettings = Readonly<Record<string, boolean>>;

export interface TxtTestCase {
  readonly file: string;
  /** 1-based line of the `>>` input line. */
  readonly line: number;
  readonly input: string;
  readonly expected: string;
}

export interface TxtTestFile {
  readonly file: string;
  /** Parsed `#SETUP:` settings (PowerFxV1 expanded). Keys keep any `(args)` suffix. */
  readonly setup: SetupSettings;
  readonly disables: readonly string[];
  readonly override: string | undefined;
  readonly cases: readonly TxtTestCase[];
}

/** Features turned on by the upstream `PowerFxV1` aggregate (Features.PowerFxV1). */
export const POWERFX_V1_FEATURES: readonly string[] = [
  "TableSyntaxDoesntWrapRecords",
  "ConsistentOneColumnTableResult",
  "DisableRowScopeDisambiguationSyntax",
  "SupportColumnNamesAsIdentifiers",
  "StronglyTypedBuiltinEnums",
  "RestrictedIsEmptyArguments",
  "FirstLastNRequiresSecondArguments",
  "PowerFxV1CompatibilityRules",
  "PrimaryOutputPropertyCoercionDeprecated",
  "JsonFunctionAcceptsLazyTypes",
  "IsUserDefinedTypesEnabled",
];

/** Parses a setup string such as `PowerFxV1,disable:NumberIsFloat,TimeZoneInfo("UTC")`. */
export function parseSetupString(setup: string): Record<string, boolean> {
  const settings: Record<string, boolean> = {};
  const token = /(disable:)?(([\w]+|\/\/)(\([^)]*\))?)/g;
  for (const match of setup.matchAll(token)) {
    const name = match[3];
    const complete = match[2];
    if (name === undefined || complete === undefined) continue;
    if (name === "//") break;
    settings[complete] = match[1] === undefined;
    if (complete === "PowerFxV1") {
      for (const feature of POWERFX_V1_FEATURES) settings[feature] = true;
    }
  }
  return settings;
}

function stripDirectiveComment(value: string): string {
  const index = value.indexOf("//");
  return (index >= 0 ? value.slice(0, index) : value).trim();
}

export function parseTxtTestFile(file: string, text: string): TxtTestFile {
  const lines = text.replace(/^\uFEFF+/, "").split(/\r?\n/);
  const setup: Record<string, boolean> = {};
  const disables: string[] = [];
  let override: string | undefined;
  const cases: TxtTestCase[] = [];

  const fail = (index: number, message: string): never => {
    throw new Error(`${file} ${index + 1}: ${message}`);
  };
  const skippable = (line: string) => line.trim() === "" || line.startsWith("//");

  let i = 0;
  // File header: directives only.
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (skippable(line)) continue;
    if (line.length > 1 && line[0] === "#" && !line.startsWith("#DISABLE.NET:")) {
      const upper = line.toUpperCase();
      if (upper.startsWith("#DISABLE:")) {
        disables.push(stripDirectiveComment(line.slice("#DISABLE:".length)));
      } else if (upper.startsWith("#SETUP:")) {
        const parsed = parseSetupString(line.slice("#SETUP:".length).trim());
        for (const [key, value] of Object.entries(parsed)) {
          if (key in setup && setup[key] !== value) {
            fail(i, `Duplicate and contradictory #SETUP directives: ${line}`);
          }
          setup[key] = value;
        }
      } else if (upper.startsWith("#OVERRIDE:")) {
        if (override !== undefined) fail(i, "Can't have multiple #OVERRIDE: directives");
        override = stripDirectiveComment(line.slice("#OVERRIDE:".length));
      } else {
        fail(i, `Unrecognized directive: ${line}`);
      }
      continue;
    }
    break;
  }

  let current: { line: number; input: string } | undefined;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (skippable(line)) continue;
    // `#DISABLE.NET:` only gates C# runtimes and has no meaning here.
    if (line.startsWith("#DISABLE.NET:")) continue;
    if (line.startsWith(">>")) {
      if (current) fail(i, `multiple test inputs in a row. Previous input is: ${current.input}`);
      current = { line: i + 1, input: line.slice(2).trim() };
      continue;
    }
    if (!current) fail(i, "Parse error");
    if (current && line.startsWith(" ")) {
      current.input += "\n" + line;
      continue;
    }
    if (current) {
      if (line.startsWith("/*")) fail(i, "Multiline comments aren't supported in output");
      cases.push({ file, line: current.line, input: current.input, expected: line.trim() });
      current = undefined;
    }
  }
  if (current) fail(lines.length - 1, `Test input without expected result: ${current.input}`);

  return { file, setup, disables, override, cases };
}
