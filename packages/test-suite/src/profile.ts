import { parseSetupString, type SetupSettings } from "./txt-format.js";

/**
 * A compatibility profile fixes the feature flags / numeric mode under which upstream cases are
 * selected. Reports must always name the profile; a bare pass percentage is not meaningful.
 */
export interface CompatibilityProfile {
  readonly name: string;
  /** Upstream setup string the profile was derived from (mirrors TxtFileData attributes). */
  readonly setupString: string;
  readonly settings: SetupSettings;
  readonly numberMode: "float" | "decimal";
  readonly culture: string;
  readonly timeZone: string;
}

function profile(
  name: string,
  setupString: string,
  numberMode: "float" | "decimal",
): CompatibilityProfile {
  return {
    name,
    setupString,
    settings: parseSetupString(setupString),
    numberMode,
    culture: "en-US",
    timeZone: "UTC",
  };
}

/**
 * Profiles mirror `FileExpressionEvaluationTests` in the upstream interpreter tests.
 * `v1-decimal` is the current Power Fx 1.0 default (Number is Decimal-backed).
 */
export const PROFILES: Readonly<Record<string, CompatibilityProfile>> = {
  "v1-decimal": profile("v1-decimal", "PowerFxV1,disable:NumberIsFloat,DecimalSupport", "decimal"),
  "v1-float": profile("v1-float", "PowerFxV1,NumberIsFloat,DecimalSupport", "float"),
};

/** Setup tokens that are runner-side handlers rather than engine features or parser flags. */
export const SETUP_HANDLERS: ReadonlySet<string> = new Set([
  "AllEnumsSetup",
  "AllEnumsPlusTestEnumsSetup",
  "AllEnumsPlusTestOptionSetsSetup",
  "AsyncTestSetup",
  "DisableMemChecks",
  "MutationFunctionsTestSetup",
  "OptionSetSortTestSetup",
  "OptionSetTestSetup",
  "TraceSetup",
  "TimeZoneInfo",
  "CultureInfo",
  "RegEx",
  "Blob",
  "EnableJsonFunctions",
]);

export function setupName(key: string): string {
  const paren = key.indexOf("(");
  return paren >= 0 ? key.slice(0, paren) : key;
}

/**
 * Mirrors upstream applicability: a file is skipped if any of its settings contradicts the profile,
 * or contradicts the profile's `Default` when the setting is not named explicitly.
 */
export function isApplicable(fileSetup: SetupSettings, active: CompatibilityProfile): boolean {
  const settings = active.settings;
  for (const [key, value] of Object.entries(fileSetup)) {
    if (key in settings) {
      if (settings[key] !== value) return false;
    } else if ("Default" in settings && settings["Default"] !== value) {
      return false;
    }
  }
  return true;
}

/** Enabled runner-side handlers a file needs (flags and parser options are not included). */
export function requiredHandlers(fileSetup: SetupSettings): string[] {
  return Object.entries(fileSetup)
    .filter(([key, enabled]) => enabled && SETUP_HANDLERS.has(setupName(key)))
    .map(([key]) => key);
}
