/**
 * A workflow step that pipes a command into `tee` runs with pipefail.
 *
 * GitHub runs a `run:` script with `bash -e {0}` unless the step names a
 * shell, and without pipefail a pipeline's exit status is its last command's.
 * `tee` always succeeds, so `node scripts/mutation-floors.mjs | tee -a
 * "$GITHUB_STEP_SUMMARY"` passed whatever the floors said. A step that names
 * `shell: bash` runs as `bash --noprofile --norc -eo pipefail {0}`; this guard
 * asks for that and for `set -o pipefail` in the script as well, so the
 * intent is visible where the pipe is.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

interface Step {
  name?: string;
  run?: string;
  shell?: string;
}

/** Whether a script pipes something into `tee` on a line that is not a comment. */
function pipesIntoTee(script: string): boolean {
  return script
    .split("\n")
    .some((line) => !/^\s*#/.test(line) && /[^|]\|\s*tee\b/.test(line));
}

/** The steps of a workflow that pipe into `tee` without pipefail. */
function offenders(file: string, text: string): string[] {
  const doc = YAML.parse(text) as {
    defaults?: { run?: { shell?: string } };
    jobs?: Record<
      string,
      { defaults?: { run?: { shell?: string } }; steps?: Step[] }
    >;
  };
  const out: string[] = [];
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    (job.steps ?? []).forEach((step, index) => {
      if (!step.run || !pipesIntoTee(step.run)) return;
      const shell =
        step.shell ?? job.defaults?.run?.shell ?? doc.defaults?.run?.shell;
      const ok = shell === "bash" && /\bset -o pipefail\b/.test(step.run);
      if (!ok) out.push(`${file} ${jobName} #${index} ${step.name ?? ""}`);
    });
  }
  return out;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
}

describe("workflow steps that pipe into tee", () => {
  it("reads the workflows it claims to check", () => {
    expect(workflowFiles().length).toBeGreaterThan(10);
    const teeSteps = workflowFiles().filter((f) =>
      pipesIntoTee(readFileSync(join(WORKFLOWS, f), "utf8")),
    );
    expect(teeSteps.length).toBeGreaterThan(0);
  });

  it("run with pipefail", () => {
    const found = workflowFiles().flatMap((f) =>
      offenders(f, readFileSync(join(WORKFLOWS, f), "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("catches the shape it guards against", () => {
    const bad = [
      "jobs:",
      "  check:",
      "    steps:",
      "      - name: floors",
      '        run: node scripts/mutation-floors.mjs | tee -a "$GITHUB_STEP_SUMMARY"',
    ].join("\n");
    expect(offenders("bad.yml", bad)).toEqual(["bad.yml check #0 floors"]);
    const good = [
      "jobs:",
      "  check:",
      "    steps:",
      "      - name: floors",
      "        shell: bash",
      "        run: |",
      "          set -o pipefail",
      '          node scripts/mutation-floors.mjs | tee -a "$GITHUB_STEP_SUMMARY"',
    ].join("\n");
    expect(offenders("good.yml", good)).toEqual([]);
  });
});
