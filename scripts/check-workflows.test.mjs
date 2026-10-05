// The workflow hardening gate (scripts/check-workflows.mjs) on small workflows written here. It tests the gate, not
// Pigpen's own workflow: `npm run quality` runs the gate over .github/workflows, and a hosted run is the workflow's test.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hardeningProblems, pinProblems, targetProblems } from './check-workflows.mjs';

const sha = 'a'.repeat(40);
const good = `
on: { pull_request: {} }
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${sha} # v4
        with: { persist-credentials: false }
      - uses: ./.github/actions/local
      - run: echo ok
`;

describe('hardeningProblems', () => {
  it('accepts a pinned, read-only, secret-free workflow', () => {
    assert.deepEqual(hardeningProblems('ci.yml', good), []);
  });

  it('refuses an action pinned to a tag or branch', () => {
    const problems = hardeningProblems('ci.yml', good.replace(`@${sha}`, '@v4'));
    assert.match(problems.join('\n'), /ci\.yml: actions\/checkout@v4 is not pinned to a full commit SHA/);
  });

  it('refuses a reusable workflow that is not pinned', () => {
    const text = good.replace('  build:\n', '  reuse:\n    uses: org/repo/.github/workflows/x.yml@main\n  build:\n');
    assert.match(hardeningProblems('ci.yml', text).join('\n'), /org\/repo\/\.github\/workflows\/x\.yml@main is not pinned/);
  });

  it('refuses missing, write or widened permissions', () => {
    assert.match(hardeningProblems('ci.yml', good.replace('permissions:\n  contents: read\n', '')).join('\n'), /no top-level permissions/);
    assert.match(hardeningProblems('ci.yml', good.replace('contents: read', 'contents: write')).join('\n'), /contents: write/);
    assert.match(hardeningProblems('ci.yml', good.replace('permissions:\n  contents: read', 'permissions: write-all')).join('\n'), /write-all/);
    const job = good.replace('    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    permissions: { packages: write }\n');
    assert.match(hardeningProblems('ci.yml', job).join('\n'), /job build: packages: write/);
  });

  it('refuses secrets and pull_request_target', () => {
    assert.match(hardeningProblems('ci.yml', good.replace('echo ok', 'echo ${{ secrets.TOKEN }}')).join('\n'), /uses a secret/);
    assert.match(hardeningProblems('ci.yml', good.replace('pull_request: {}', 'pull_request_target: {}')).join('\n'), /pull_request_target/);
  });

  it('refuses a checkout that keeps its token, and a job without a timeout', () => {
    assert.match(hardeningProblems('ci.yml', good.replace('persist-credentials: false', 'fetch-depth: 0')).join('\n'), /persist-credentials: false/);
    assert.match(hardeningProblems('ci.yml', good.replace('    timeout-minutes: 10\n', '')).join('\n'), /job build has no timeout-minutes/);
  });
});

describe('pinProblems', () => {
  const requirement = { release: { repository: 'Owner/PiG', commit: 'c'.repeat(40) } };
  const workflow = (commit, ref = '${{ env.PIG_COMMIT }}') => ({
    env: { PIG_COMMIT: commit },
    jobs: { a: { steps: [{ uses: `actions/checkout@${sha}`, with: { repository: 'Owner/PiG', ref } }] } },
  });

  it('accepts one PiG pin, equal to the requirement and used by every PiG checkout', () => {
    assert.deepEqual(pinProblems(workflow('c'.repeat(40)), requirement), []);
  });

  it('refuses a PIG_COMMIT that differs from scripts/pig-requirement.json', () => {
    assert.match(pinProblems(workflow('d'.repeat(40)), requirement).join('\n'), /PIG_COMMIT .* is not the pinned release commit/);
  });

  it('refuses a PiG checkout at its own ref', () => {
    assert.match(pinProblems(workflow('c'.repeat(40), 'main'), requirement).join('\n'), /checks out Owner\/PiG at main/);
  });
});

describe('targetProblems', () => {
  const runners = { 'linux/amd64': 'ubuntu-24.04', 'windows/amd64': 'windows-2025' };
  const workflow = (include) => ({ jobs: { 'platform-matrix': { strategy: { matrix: { include } } } } });

  it('accepts a matrix with each declared target on its native runner', () => {
    const include = [{ target: 'linux/amd64', runner: 'ubuntu-24.04' }, { target: 'windows/amd64', runner: 'windows-2025' }];
    assert.deepEqual(targetProblems(workflow(include), ['linux/amd64', 'windows/amd64'], runners), []);
  });

  it('refuses a declared target the matrix does not build, and a target on the wrong runner', () => {
    const problems = targetProblems(workflow([{ target: 'linux/amd64', runner: 'windows-2025' }]), ['linux/amd64', 'windows/amd64'], runners).join('\n');
    assert.match(problems, /windows\/amd64 is a manifest target the platform matrix does not build/);
    assert.match(problems, /linux\/amd64 runs on windows-2025, not ubuntu-24\.04/);
  });
});
