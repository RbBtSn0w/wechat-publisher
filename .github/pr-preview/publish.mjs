import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { archive, card, guard, mirrorRegistry, npmRegistry, readLatest, verify } from './preview.mjs';

export async function observe({ integrity, version, lookup, write, next, wait }) {
  let observed = await lookup();
  if (observed === null) {
    const status = await write();
    for (const delay of [0, 2, 4, 8, 12]) {
      await wait(delay);
      observed = await lookup();
      if (observed !== null) break;
    }
    assert(observed !== null, 'No registry read-back after one publish attempt (exit ' + status + ')');
  }
  assert.equal(observed, integrity, 'Registry integrity differs from the verified archive');
  let current = false;
  try {
    current = await next() === version;
  } catch (error) {
    console.warn('::warning::Could not confirm the moving next tag: ' + error.message);
  }
  return { available: true, next: current };
}

function currentHead(receipt) {
  const { GITHUB_REPOSITORY } = process.env;
  const pr = JSON.parse(execFileSync('gh', ['api', 'repos/' + GITHUB_REPOSITORY + '/pulls/' + receipt.pr], {
    encoding: 'utf8', timeout: 12000,
  }));
  return pr.state === 'open' && pr.base.ref === 'main' && pr.head.sha === receipt.head &&
    pr.head.repo?.full_name?.toLowerCase() === GITHUB_REPOSITORY.toLowerCase() &&
    pr.base.repo?.full_name?.toLowerCase() === GITHUB_REPOSITORY.toLowerCase();
}

async function registryPreview(dir, receipt, registry) {
  const config = mkdtempSync(join(tmpdir(), 'npm-pr-preview-'));
  try {
    const userconfig = join(config, 'user.npmrc');
    const globalconfig = join(config, 'global.npmrc');
    const configText = registry === mirrorRegistry ? '//npm.pkg.github.com/:_authToken=${MIRROR_TOKEN}\n' : '';
    writeFileSync(userconfig, configText, { mode: 0o600 });
    writeFileSync(globalconfig, '');
    const run = (args, inherit = false) => spawnSync('npm', [
      ...args, '--registry', registry, '--userconfig', userconfig, '--globalconfig', globalconfig,
      '--cache', join(config, 'cache'), '--prefer-online', '--fetch-retries=0', '--fetch-timeout=10000',
    ], { cwd: dir, encoding: 'utf8', timeout: 30000, stdio: inherit ? 'inherit' : 'pipe' });
    const spec = receipt.name + '@' + receipt.version;
    const view = (args, allowMissing = false) => {
      const result = run(['view', ...args, '--json']);
      if (result.error) throw result.error;
      const output = result.stdout.trim();
      const value = output ? JSON.parse(output) : undefined;
      if (allowMissing && result.status !== 0 && value?.error?.code === 'E404') return null;
      assert.equal(result.status, 0, 'npm view failed (' + (value?.error?.code ?? result.status) + ')');
      return value;
    };
    return await observe({
      ...receipt,
      lookup() {
        const value = view([spec, 'dist.integrity'], true);
        if (value === null) return null;
        const integrity = Array.isArray(value) && value.length === 1 ? value[0] : value;
        assert(typeof integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity),
          'Missing or ambiguous registry integrity');
        return integrity;
      },
      async write() {
        guard(receipt.version, receipt.baseline, await readLatest());
        assert(currentHead(receipt), 'PR head changed before registry write');
        const result = run(['publish', './' + archive, '--ignore-scripts', '--access', 'public', '--tag', 'next'], true);
        if (result.error) console.warn('::warning::npm publish outcome is uncertain: ' + result.error.message);
        return result.status;
      },
      next: () => view([receipt.name, 'dist-tags.next']),
      wait: seconds => setTimeout(seconds * 1000),
    });
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
}

async function main(dir) {
  const env = process.env;
  const receipt = verify(dir, {
    pr: env.PR_NUMBER, head: env.PR_HEAD, runId: env.SOURCE_RUN_ID, attempt: env.PACKAGING_ATTEMPT,
  }, true);
  const results = {};
  for (const [enabled, key, registry] of [
    [env.PUBLISH_NPMJS, 'npm', npmRegistry],
    [env.PUBLISH_MIRROR, 'mirror', mirrorRegistry],
  ]) {
    if (enabled !== 'true') continue;
    try {
      results[key] = await registryPreview(dir, receipt, registry);
    } catch (error) {
      console.warn('::warning::' + registry + ' did not confirm the preview: ' + error.message);
    }
  }
  assert(results.npm || results.mirror, 'No authorized registry confirmed the exact archive');
  const panel = card(receipt, env.ARTIFACT_ID, env.GITHUB_REPOSITORY, results);
  appendFileSync(env.GITHUB_STEP_SUMMARY, panel + '\n');
  appendFileSync(env.GITHUB_OUTPUT, 'panel<<PR_PREVIEW_CARD\n' + panel + '\nPR_PREVIEW_CARD\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
