import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILES } from "./profile.js";
import { createEngineRunner } from "./engine-runner.js";
import { runCompat, unsupportedRunner, type CompatReport } from "./runner.js";
import { parseTxtTestFile } from "./txt-format.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const upstreamRoot = resolve(packageRoot, "../../upstream/Power-Fx");
const casesDir = join(
  upstreamRoot,
  "src/tests/Microsoft.PowerFx.Core.Tests.Shared/ExpressionTestCases",
);

function formatMarkdown(report: CompatReport): string {
  const t = report.totals;
  const lines = [
    `# Compatibility report: ${report.profile}`,
    "",
    `- Upstream commit: \`${report.upstreamCommit}\``,
    `- Runner: ${report.runner}`,
    `- Setup: \`${report.setupString}\` (number mode: ${report.numberMode}, culture ${report.culture}, time zone ${report.timeZone})`,
    `- Cases: ${t.cases} total, ${t.inapplicable} not applicable to this profile`,
    `- Pass ${t.pass}, fail ${t.fail}, skip ${t.skip}, unsupported ${t.unsupported}`,
    `- Unsupported by reason: feature ${report.unsupportedByCategory.feature}, setup ${report.unsupportedByCategory.setup}, profile ${report.unsupportedByCategory.profile}`,
    `- Passing compile-error cases whose error set differs from upstream's (strict diagnostic, not a verdict): ${report.strictErrorMismatches}`,
    `- Passing numeric cases accepted only by upstream's float tolerance (diagnostic, not a verdict): ${report.toleranceOnlyPasses}`,
    "",
    "| File | Total | Pass | Fail | Skip | Unsupported |",
    "| ---- | ----: | ---: | ---: | ---: | ----------: |",
  ];
  for (const f of report.files.filter((x) => x.applicable)) {
    const c = f.counts;
    const name = f.file.split("/").pop();
    lines.push(`| ${name} | ${f.total} | ${c.pass} | ${c.fail} | ${c.skip} | ${c.unsupported} |`);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const profileName = process.argv[2] ?? "v1-decimal";
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile ${profileName}: ${Object.keys(PROFILES)}`);

  const upstreamCommit = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const files = readdirSync(casesDir)
    .filter((name) => name.endsWith(".txt"))
    .sort()
    .map((name) => parseTxtTestFile(name, readFileSync(join(casesDir, name), "utf8")));

  const runnerName = process.argv[3] ?? "engine";
  const runner =
    runnerName === "engine"
      ? createEngineRunner()
      : runnerName === "unsupported"
        ? unsupportedRunner
        : undefined;
  if (!runner) throw new Error(`Unknown runner ${runnerName}: engine | unsupported`);

  const report = await runCompat({ files, profile, runner, runnerName, upstreamCommit });
  const outDir = join(packageRoot, "reports");
  mkdirSync(outDir, { recursive: true });
  const { caseOutcomes, ...serializable } = report;
  writeFileSync(
    join(outDir, `${profileName}.${runnerName}.json`),
    JSON.stringify(serializable, null, 2),
  );
  writeFileSync(
    join(outDir, `${profileName}.${runnerName}.cases.tsv`),
    caseOutcomes.map((c) => `${c.file.split("/").pop()}:${c.line}\t${c.outcome}`).join("\n") + "\n",
  );
  writeFileSync(join(outDir, `${profileName}.${runnerName}.md`), formatMarkdown(report));
  console.log(formatMarkdown(report).split("\n").slice(0, 8).join("\n"));
}

void main();
