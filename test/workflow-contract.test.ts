import fs from 'fs';
import YAML from 'yaml';
import { spawnSync } from 'child_process';
import { expect, test } from 'vitest';
const read = (file: string) => fs.readFileSync(file, 'utf8');
const workflow = (name: string) => YAML.parse(read(`.github/workflows/${name}.yml`));

test('a fork named develop cannot impersonate the trusted promotion branch', () => {
  const script = workflow('pr-target').jobs['validate-base'].steps[0].run;
  const execute = (headRepo: string) => spawnSync('/bin/bash', ['-c', script], {
    env: { ...process.env, BASE_REF: 'main', HEAD_REF: 'develop', HEAD_REPO: headRepo, BASE_REPO: 'owner/project' },
  }).status;
  expect(execute('attacker/project')).toBe(1);
  expect(execute('owner/project')).toBe(0);
});

test('package entrypoint and payload are explicit and release plugins are declared', () => {
  const pkg = JSON.parse(read('package.json'));
  expect(pkg.main).toBe('dist/src/index.js');
  expect(pkg.files).toEqual(['dist', 'templates', 'skills', 'docs', 'README.md']);
  expect(pkg.devDependencies['semantic-release']).toMatch(/^\^25\./);
  const config = JSON.parse(read('.releaserc.json'));
  const plugins = config.plugins.map((plugin: string | unknown[]) => Array.isArray(plugin) ? plugin[0] : plugin);
  expect(plugins).not.toContain('@semantic-release/git');
  for (const plugin of plugins) expect(pkg.devDependencies[plugin]).toBeTruthy();
});

test('promotion is proposal only with semantic no-op check and body file', () => {
  const source = read('.github/workflows/scheduled-release-pr.yml');
  expect(source).not.toMatch(/gh pr merge|--auto\b|auto-merge is enabled/i);
  expect(source).toContain('scripts/propose-release.mjs');
  const script = read('scripts/propose-release.mjs');
  expect(script).toContain('analyzeCommits');
  expect(script).toContain('--body-file');
  expect(script).toContain('closingIssuesReferences');
});

test('release output gates mirror and lifecycle writes serialize across workflows', () => {
  const release = workflow('release');
  expect(release.concurrency).toEqual({ group: 'wechat-publisher-lifecycle', 'cancel-in-progress': false });
  const steps = release.jobs.release.steps;
  expect(steps.find((step: any) => step.id === 'semantic').run).toContain('scripts/release.mjs');
  expect(steps.find((step: any) => step.name === 'Mirror to GitHub Packages').if).toBe("steps.semantic.outputs.released == 'true'");
  expect(read('.github/workflows/release.yml')).not.toContain('git merge');
  expect(workflow('scheduled-release-pr').concurrency).toEqual(release.concurrency);
  expect(workflow('sync-main-to-develop').concurrency).toEqual(release.concurrency);
});

test('trusted lifecycle controller is opt-in, uses dedicated runner and independent polling', () => {
  const sync = workflow('sync-main-to-develop');
  expect(sync.on.schedule).toContainEqual({ cron: '*/5 * * * *' });
  expect(sync.on).toHaveProperty('delete');
  expect(sync.on.pull_request_target.types).toContain('closed');
  expect(sync.jobs.sync['runs-on']).toEqual(['self-hosted', 'release-train-wechat-publisher']);
  expect(sync.jobs.sync['timeout-minutes']).toBe(10);
  expect(sync.jobs.sync.if).toContain("vars.RELEASE_TRAIN_ENABLED == 'true'");
  const checkout = sync.jobs.sync.steps.find((step: any) => step.uses?.startsWith('actions/checkout@'));
  expect(checkout.with.ref).toBe('main');
  expect(checkout.with['persist-credentials']).toBe(false);
  expect(sync.jobs.sync.steps.find((step: any) => step.uses?.startsWith('actions/setup-python@')).with['python-version']).toBe('3.13');
  expect(read('.github/workflows/sync-main-to-develop.yml')).toContain('RELEASE_TRAIN_TOKEN:');
  expect(read('.github/workflows/sync-main-to-develop.yml')).toContain('export GH_TOKEN="$RELEASE_TRAIN_TOKEN"');
  for (const name of ['ci', 'pr-target']) {
    for (const job of Object.values(workflow(name).jobs) as any[]) expect(job['runs-on']).toBe('ubuntu-latest');
  }
});
