import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { card, guard, readLatest, verify, versionFor } from '../.github/pr-preview/preview.mjs';
import { observe } from '../.github/pr-preview/publish.mjs';

const { name } = JSON.parse(readFileSync('package.json', 'utf8'));
const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const publication = parse(readFileSync('.github/workflows/pr-preview-publish.yml', 'utf8'));
const head = '0123456' + 'a'.repeat(33);
const version = '2.1.5-dev.pr89.g0123456';
const repo = 'RbBtSn0w/' + name.split('/')[1];
const identity = { head, pr: '89', runId: '7', attempt: '1' };

test('version follows package-specific stable latest and normalizes a numeric prefix with leading zero', async () => {
  const latest = await readLatest(async (url, options) => {
    assert.match(url, /^https:\/\/registry\.npmjs\.org\//);
    assert(url.includes(encodeURIComponent(name) + '/latest'));
    assert.equal(options.cache, 'no-store');
    return Response.json({ name, version: '2.1.4' });
  });
  assert.equal(versionFor('1.0.0', '89', head, latest), version);
  assert.equal(versionFor('3.0.0-rc.1', '89', head, latest), '3.0.0-dev.pr89.g0123456');
  assert.equal(versionFor('1.0.0', '89', head, null), '1.0.0-dev.pr89.g0123456');
  for (const body of [{ name }, { name, version: '2.1.4\n' }, { name: 'wrong', version: '2.1.4' }]) {
    await assert.rejects(readLatest(async () => Response.json(body)));
  }
  await assert.rejects(readLatest(async () => new Response('', { status: 503 })));
  assert.throws(() => guard(version, null, latest), /build-time/);
  assert.throws(() => guard(version, latest, '2.1.5'), /caught up/);
  assert.doesNotThrow(() => guard(version, latest, latest));
});

function archiveFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'preview-verify-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  mkdirSync(join(dir, 'package'));
  function pack(packed, receiptFields = {}) {
    writeFileSync(join(dir, 'package/package.json'), JSON.stringify(packed));
    execFileSync('tar', ['-czf', 'pr-preview.tgz', 'package/package.json'], { cwd: dir });
    const sha256 = createHash('sha256').update(readFileSync(join(dir, 'pr-preview.tgz'))).digest('hex');
    const receipt = { ...identity, name, version, sha256, baseline: '2.1.4', ...receiptFields };
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt));
    writeFileSync(join(dir, 'SHA256SUMS'), sha256 + '  pr-preview.tgz\n');
    return receipt;
  }
  return { dir, pack };
}

test('downloaded bytes must match identity, package name, version and checksum', t => {
  const { dir, pack } = archiveFixture(t);
  const publishConfig = JSON.parse(readFileSync('package.json', 'utf8')).publishConfig;
  pack({ name, version, publishConfig });
  assert.equal(verify(dir, identity, true).version, version);
  assert.throws(() => verify(dir, { ...identity, head: 'b'.repeat(40) }), /head/);
  assert.throws(() => verify(dir, { ...identity, attempt: '2' }), /attempt/);
  writeFileSync(join(dir, 'pr-preview.tgz'), 'changed archive');
  assert.throws(() => verify(dir, identity), /SHA-256/);
  pack({ name: 'wrong', version, publishConfig });
  assert.throws(() => verify(dir, identity), /package name/);
  pack({ name, version: '1.0.0', publishConfig });
  assert.throws(() => verify(dir, identity), /package version/);
  pack({ name, version, publishConfig: { directory: 'other' } });
  assert.throws(() => verify(dir, identity, true), /publishConfig/);
});

test('registry read-back avoids re-publishing known or ambiguous versions', async () => {
  const integrity = 'sha512-fixture';
  const calls = [];
  const common = {
    integrity, version,
    write: () => { calls.push('write'); return 1; },
    wait: () => {},
    next: () => version,
  };
  assert.deepEqual(await observe({ ...common, lookup: () => integrity }), { available: true, next: true });
  assert.deepEqual(await observe({
    ...common, lookup: () => integrity, next: () => 'some-other-version',
  }), { available: true, next: false });
  await assert.rejects(observe({ ...common, lookup: () => 'conflict' }), /integrity differs/);
  await assert.rejects(observe({ ...common, lookup: () => { throw new Error('unavailable'); } }), /unavailable/);
  assert.deepEqual(calls, []);
  const observations = [null, null, integrity];
  assert.deepEqual(await observe({ ...common, lookup: () => observations.shift() }), { available: true, next: true });
  assert.deepEqual(calls, ['write']);
});

test('cards present exact commands and per-registry state', t => {
  const { pack } = archiveFixture(t);
  const receipt = pack({ name, version }, { baseline: null });
  const none = card(receipt, '123', repo);
  assert.match(none, /could not be verified/);
  assert.match(none, /\/actions\/artifacts\/123\/zip/);
  assert(none.includes(receipt.sha256) && none.includes(head));
  assert.match(none, /pr-preview\.tgz/);
  const npm = card(receipt, '123', repo, { npm: { available: true, next: false } });
  const mirror = card(receipt, '123', repo, { mirror: { available: true, next: true } });
  const both = card(receipt, '123', repo, {
    npm: { available: true, next: true }, mirror: { available: true, next: false },
  });
  assert(npm.includes(name + '@' + version));
  assert(npm.indexOf('Try this exact') < npm.indexOf('Download and verify'));
  assert.match(npm, /Unconfirmed/);
  assert.doesNotMatch(npm, /read:packages/);
  assert.match(mirror, /npm pack --ignore-scripts --registry=https:\/\/npm.pkg.github.com/);
  assert.match(mirror, /read:packages/);
  assert.match(mirror, /Pointed here/);
  assert.match(both, /npmjs[\s\S]+GitHub Packages/);
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const commentJob = workflow.jobs['pr-preview-comment'];

function githubScript(step, github, context, core, env) {
  return new AsyncFunction('github', 'context', 'core', 'process', 'require', step.with.script)(
    github, context, core, { env }, name => {
      if (name === 'node:fs') return { readFileSync };
      if (name === 'node:path') return { join };
      if (name === 'node:crypto') return { createHash };
      throw new Error('Unexpected module: ' + name);
    },
  );
}

test('resolve the successful packaging attempt on comment reruns and reject unavailable or stale archives', async () => {
  for (const job of [commentJob, publication.jobs.publish]) {
    const source = job.steps.find(step => step.id === 'source');
    const pr = { number: 89, state: 'open', head: { sha: head, repo: { id: 2 } }, base: { ref: 'main', repo: { id: 2 } } };
    const run = {
      path: '.github/workflows/ci.yml', id: 7, event: 'pull_request', run_attempt: 2,
      repository: { id: 2 }, head_repository: { id: 2 }, head_sha: head,
      conclusion: 'success', pull_requests: [{ number: 89, head: { sha: head } }],
    };
    const jobs = [{
      run_id: 7, name: 'PR preview package', run_attempt: 1, conclusion: 'success',
      steps: [{ name: 'Upload verified preview', conclusion: 'success' }],
    }];
    const name = 'pr-preview-89-' + head + '-attempt-1';
    let artifacts = [{ name, id: 123, expired: false }];
    const outputs = {};
    const exec = () => githubScript(source, {
      rest: {
        actions: {
          getWorkflowRun: async () => ({ data: run }),
          listJobsForWorkflowRun: async () => jobs,
          listWorkflowRunArtifacts: async args => {
            assert.equal(args.name, name);
            return artifacts;
          },
        },
        pulls: { get: async () => ({ data: pr }) },
      },
      paginate: (fn, args) => fn(args),
    }, { repo: { owner: 'RbBtSn0w', repo }, payload: { pull_request: pr } }, {
      notice() {}, setOutput: (key, value) => { outputs[key] = value; },
    }, { SOURCE_RUN_ID: '7' });
    await exec();
    assert.deepEqual(outputs, { pr: 89, head, attempt: 1, artifact: 123 });
    for (const value of [[], [{ name, id: 123, expired: true }]]) {
      artifacts = value;
      await assert.rejects(exec(), /unexpired/);
    }
    const eventHead = pr.head.sha;
    pr.head = { ...pr.head, sha: 'b'.repeat(40) };
    if (job === commentJob) await assert.rejects(exec(), /differs from event/);
    else await exec();
    pr.head.sha = eventHead;
    assert.equal(job.steps.find(step => step.with?.['artifact-ids']).with['merge-multiple'], true);
  }
  assert.match(commentJob.if, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow.jobs['pr-preview'].if, /pull_request/);
  assert.equal(workflow.jobs['pr-preview'].permissions.contents, 'read');
});

test('comment writer is idempotent, preserves published cards and rereads head', async t => {
  const { dir, pack } = archiveFixture(t);
  const receipt = pack({ name, version });
  mkdirSync(join(dir, 'comment-preview'));
  for (const file of ['receipt.json', 'pr-preview.tgz']) {
    writeFileSync(join(dir, 'comment-preview', file), readFileSync(join(dir, file)));
  }
  writeFileSync(join(dir, 'comment-preview/card.md'), card(receipt, '99999999999999', repo));
  const step = commentJob.steps.at(-1);
  let existing = null;
  let currentHead = head;
  const mutations = [];
  const marker = '<!-- pr-installable-preview -->';
  const exec = () => githubScript(step, {
    rest: {
      pulls: { get: async () => ({
        data: { state: 'open', head: { sha: currentHead, repo: { id: 2 } }, base: { ref: 'main', repo: { id: 2 } } },
      }) },
      issues: {
        listComments: async () => existing ? [existing] : [],
        createComment: async ({ body }) => {
          existing = { id: 42, user: { login: 'github-actions[bot]' }, body };
          mutations.push('create');
        },
        updateComment: async ({ body }) => { existing.body = body; mutations.push('update'); },
      },
    },
    paginate: (fn, args) => fn(args),
  }, { repo: { owner: 'RbBtSn0w', repo } }, { notice() {} }, {
    RUNNER_TEMP: dir, PR_NUMBER: '89', PR_HEAD: head, ARTIFACT_ID: '123',
    PACKAGING_ATTEMPT: '1', SOURCE_RUN_ID: '7',
  });
  currentHead = 'c'.repeat(40);
  await exec();
  assert.deepEqual(mutations, []);
  currentHead = head;
  await exec();
  await exec();
  assert.deepEqual(mutations, ['create']);
  assert.match(existing.body, /artifacts\/123/);
  existing.body = marker + '\nolder body';
  await exec();
  assert.deepEqual(mutations, ['create', 'update']);
  existing.body = marker + '\n<!-- verified-registry-preview:' + head + ' -->\nregistry evidence';
  await exec();
  assert.deepEqual(mutations, ['create', 'update']);
});
