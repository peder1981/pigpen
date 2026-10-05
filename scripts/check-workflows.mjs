#!/usr/bin/env node
// Workflow hardening gate, part of `npm run quality`: the checks PiG's `make compliance` makes on its own workflows.
// Every workflow under .github/workflows must pin each action to a full commit SHA, ask for a read-only token, use no
// secrets and no pull_request_target, never persist the checkout token, and bound every job. ci.yml must also keep its one
// PiG pin equal to scripts/pig-requirement.json and build every target a Piglet manifest declares on that target's native
// runner (scripts/runners.mjs), so the pin and the target list each have one source.
//
// This checks hardening and drift, not behaviour: what the workflow does is shown by running it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const shaPinned = /^[^@\s]+@[0-9a-f]{40}$/;

/** Problems with one workflow's hardening; `name` prefixes each message. */
export function hardeningProblems(name, text) {
  const problems = [];
  const workflow = parse(text) ?? {};
  const jobs = Object.entries(workflow.jobs ?? {});
  const writes = (permissions) => (typeof permissions === 'string'
    ? (permissions === 'read-all' ? [] : [permissions])
    : Object.entries(permissions ?? {}).filter(([, level]) => level !== 'read' && level !== 'none').map(([scope, level]) => `${scope}: ${level}`));

  if (workflow.permissions === undefined) problems.push(`${name}: no top-level permissions (the default token may be read-write)`);
  for (const grant of writes(workflow.permissions)) problems.push(`${name}: top-level permissions grant ${grant}`);
  if (workflow.on && typeof workflow.on === 'object' && 'pull_request_target' in workflow.on) problems.push(`${name}: runs on pull_request_target`);
  if (/\$\{\{\s*secrets\./.test(text)) problems.push(`${name}: uses a secret`);

  for (const [id, job] of jobs) {
    for (const grant of writes(job.permissions)) problems.push(`${name}: job ${id}: ${grant}`);
    if (job.uses && !job.uses.startsWith('./') && !shaPinned.test(job.uses)) problems.push(`${name}: ${job.uses} is not pinned to a full commit SHA`);
    if (!job.uses && !(job['timeout-minutes'] > 0)) problems.push(`${name}: job ${id} has no timeout-minutes`);
    for (const step of job.steps ?? []) {
      if (!step.uses || step.uses.startsWith('./') || step.uses.startsWith('docker://')) continue;
      if (!shaPinned.test(step.uses)) problems.push(`${name}: ${step.uses} is not pinned to a full commit SHA`);
      if (step.uses.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) {
        problems.push(`${name}: job ${id}: a checkout without persist-credentials: false keeps the token on disk`);
      }
    }
  }
  return problems;
}

/** ci.yml's PiG pin is the release commit in scripts/pig-requirement.json, and every PiG checkout uses it. */
export function pinProblems(workflow, requirement) {
  const problems = [];
  const { repository, commit } = requirement.release;
  if (workflow.env?.PIG_COMMIT !== commit) problems.push(`ci.yml: PIG_COMMIT ${workflow.env?.PIG_COMMIT} is not the pinned release commit ${commit} (scripts/pig-requirement.json)`);
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.with?.repository === repository && step.with.ref !== '${{ env.PIG_COMMIT }}') problems.push(`ci.yml: checks out ${repository} at ${step.with.ref}, not \${{ env.PIG_COMMIT }}`);
    }
  }
  return problems;
}

/** ci.yml's platform matrix builds every declared target on that target's native runner. */
export function targetProblems(workflow, declared, runners) {
  const problems = [];
  const include = workflow.jobs?.['platform-matrix']?.strategy?.matrix?.include ?? [];
  const built = new Set(include.map((entry) => entry.target));
  for (const target of declared) if (!built.has(target)) problems.push(`ci.yml: ${target} is a manifest target the platform matrix does not build`);
  for (const { target, runner } of include) {
    if (runners[target] !== runner) problems.push(`ci.yml: ${target} runs on ${runner}, not ${runners[target] ?? 'a runner listed in scripts/runners.mjs'}`);
  }
  return problems;
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { readManifests } = await import('./generate-index.mjs');
  const { runners } = await import('./runners.mjs');
  const dir = join(root, '.github/workflows');
  const problems = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const text = readFileSync(join(dir, file), 'utf8');
    problems.push(...hardeningProblems(file, text));
    if (file === 'ci.yml') {
      const workflow = parse(text);
      const requirement = JSON.parse(readFileSync(join(root, 'scripts/pig-requirement.json'), 'utf8'));
      const declared = [...new Set(readManifests().flatMap(({ manifest }) => manifest.build?.targets ?? []))].sort();
      problems.push(...pinProblems(workflow, requirement), ...targetProblems(workflow, declared, runners));
    }
  }
  for (const problem of problems) console.error(`check-workflows: ${problem}`);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
