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
  const lifecycleConcurrency = release.jobs.release.concurrency;
  expect(lifecycleConcurrency).toEqual({ group: 'wechat-publisher-lifecycle', 'cancel-in-progress': false, queue: 'max' });
  const steps = release.jobs.release.steps;
  expect(steps.find((step: any) => step.id === 'semantic').run).toContain('scripts/release.mjs');
  expect(steps.find((step: any) => step.name === 'Mirror to GitHub Packages').if).toBe("steps.semantic.outputs.released == 'true'");
  expect(read('.github/workflows/release.yml')).not.toContain('git merge');
  expect(workflow('scheduled-release-pr').concurrency).toEqual(lifecycleConcurrency);
  expect(workflow('sync-main-to-develop').concurrency).toEqual(lifecycleConcurrency);
});

test('preview publishes from the existing trusted release workflow with its own validation and queue', () => {
  const release = workflow('release');
  expect(release.on.pull_request.branches).toEqual(['develop']);
  expect(release.on).not.toHaveProperty('pull_request_target');
  expect(workflow('ci').jobs).not.toHaveProperty('pr-dev-release');
  const preview = release.jobs['pr-dev-release'];
  expect(preview.if).toContain("github.event_name == 'pull_request'");
  expect(preview.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  expect(preview['runs-on']).toBe('ubuntu-latest');
  expect(preview.permissions.contents).toBe('read');
  expect(preview.permissions['id-token']).toBe('write');
  expect(preview.concurrency.group).not.toBe(release.jobs.release.concurrency.group);
  expect(preview.concurrency['cancel-in-progress']).toBe(false);
  const steps = preview.steps;
  const publishIndex = steps.findIndex((step: any) => step.id === 'npm_publish');
  const beforePublish = steps.slice(0, publishIndex).map((step: any) => step.run || '').join('\n');
  for (const check of ['npm run lint', 'npm test', 'npm run build', 'npm run test:package']) expect(beforePublish).toContain(check);
  const checkout = steps.find((step: any) => step.uses?.startsWith('actions/checkout@'));
  expect(checkout.with.ref).toBe('${{ github.event.pull_request.head.sha }}');
  expect(steps[publishIndex].run).toContain('node scripts/publish-preview.mjs');
  const comment = steps.find((step: any) => step.name === 'Post or Update PR Comment');
  expect(comment.if).toContain('always() && !cancelled()');
  expect(release.jobs.release.if).toContain("github.event_name != 'pull_request'");
});

test('trusted lifecycle controller is opt-in, uses dedicated runner and independent polling', () => {
  const sync = workflow('sync-main-to-develop');
  expect(sync.on.schedule).toContainEqual({ cron: '*/5 * * * *' });
  expect(sync.on).toHaveProperty('delete');
  expect(sync.on.pull_request_target.types).toContain('closed');
  expect(sync.on.pull_request_target.branches).toEqual(['main', 'develop']);
  expect(sync.jobs.sync['runs-on']).toEqual(['self-hosted', 'release-train-wechat-publisher']);
  expect(sync.jobs.sync['timeout-minutes']).toBe(10);
  expect(sync.jobs.sync.if).toContain("vars.RELEASE_TRAIN_ENABLED == 'true'");
  const checkout = sync.jobs.sync.steps.find((step: any) => step.uses?.startsWith('actions/checkout@'));
  expect(checkout.with.ref).toBe('main');
  expect(checkout.with['persist-credentials']).toBe(false);
  expect(sync.jobs.sync.steps.find((step: any) => step.uses?.startsWith('actions/setup-python@')).with['python-version']).toBe('3.13');
  expect(read('.github/workflows/sync-main-to-develop.yml')).toContain('GH_TOKEN: ${{ steps.app-token.outputs.token }}');
  expect(read('.github/workflows/sync-main-to-develop.yml')).toContain('RELEASE_TRAIN_CONTROLLER_PATH:');
  expect(read('.github/workflows/sync-main-to-develop.yml')).toContain('scripts/release-train-preflight.py');
  expect(read('.github/workflows/sync-main-to-develop.yml')).not.toContain('python3 scripts/release_train_lifecycle.py');
  for (const name of ['ci', 'pr-target']) {
    for (const job of Object.values(workflow(name).jobs) as any[]) expect(job['runs-on']).toBe('ubuntu-latest');
  }
});

test('automated proposals and synchronization use revocable repository-scoped App tokens', () => {
  for (const name of ['scheduled-release-pr', 'sync-main-to-develop']) {
    const source = read(`.github/workflows/${name}.yml`);
    const jobs = Object.values(workflow(name).jobs) as any[];
    const steps = jobs[0].steps;
    const tokenIndex = steps.findIndex((step: any) => step.id === 'app-token');
    expect(tokenIndex).toBeGreaterThan(-1);
    const token = steps[tokenIndex];
    expect(token.uses).toBe('actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510');
    expect(token.with['app-id']).toBe('${{ vars.RELEASE_BOT_APP_ID }}');
    expect(token.with['private-key']).toBe('${{ secrets.RELEASE_BOT_PRIVATE_KEY }}');
    expect(token.with.owner).toBe('${{ github.repository_owner }}');
    expect(token.with.repositories).toBe('${{ github.event.repository.name }}');
    expect(token.with['skip-token-revoke']).toBe(false);
    expect(token.with['permission-contents']).toBe('write');
    expect(token.with['permission-pull-requests']).toBe('write');
    expect(token.with['permission-checks']).toBe('read');
    expect(token.with['permission-statuses']).toBe('read');
    expect(source).not.toContain('secrets.RELEASE_TRAIN_TOKEN');
    expect(steps.slice(tokenIndex + 1).some((step: any) => step.env?.GH_TOKEN === '${{ steps.app-token.outputs.token }}')).toBe(true);
    const checkout = steps.find((step: any) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout.with.ref).toBe('main');
    expect(checkout.with['persist-credentials']).toBe(false);
  }
});
