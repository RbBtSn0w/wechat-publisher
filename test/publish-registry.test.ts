import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { expect, test } from 'vitest';

const head = 'a'.repeat(40);
const integrity = `sha512-${createHash('sha512').update('fixture artifact').digest('base64')}`;
const metadata = { name: '@scope/pkg', version: '2.0.0', gitHead: head, 'dist.integrity': integrity };

function execute(kind: 'preview' | 'mirror', scenario: Record<string, unknown>, token = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-registry-test-'));
  const manifest = JSON.stringify({ name: metadata.name, version: metadata.version, publishConfig: { registry: 'https://registry.npmjs.org/' } });
  try {
    fs.writeFileSync(path.join(root, 'package.json'), manifest);
    fs.writeFileSync(path.join(root, 'scenario.json'), JSON.stringify(scenario));
    fs.writeFileSync(path.join(root, 'git'), `#!/bin/sh\necho '${head}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'npm'), `#!/usr/bin/env node
const fs = require('fs');
const scenario = JSON.parse(fs.readFileSync('scenario.json'));
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'pack') {
  const path = require('path');
  const destination = args[args.indexOf('--pack-destination') + 1];
  fs.writeFileSync(path.join(destination, 'fixture.tgz'), 'fixture artifact');
  console.log(JSON.stringify([{filename: 'fixture.tgz'}]));
} else if (args[0] === 'view') {
  if (fs.existsSync('published.json')) console.log(fs.readFileSync('published.json', 'utf8'));
  else if (scenario.initial) console.log(JSON.stringify(scenario.initial));
  else { console.log(JSON.stringify({ error: { code: scenario.readError || 'E404' } })); console.error('registry lookup failed'); process.exit(1); }
} else if (args[0] === 'publish') {
  if (scenario.accepted) fs.writeFileSync('published.json', JSON.stringify(scenario.accepted));
  if (scenario.publishError) { console.error('publish rejected'); process.exit(23); }
} else { console.error('unexpected npm invocation'); process.exit(99); }
`, { mode: 0o755 });
    const script = path.resolve(`scripts/publish-${kind}.mjs`);
    const result = spawnSync(process.execPath, [script, ...(kind === 'preview' ? [head] : [metadata.version, 'next', head])], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`,
        NODE_AUTH_TOKEN: token ? 'fixture-token' : '', GITHUB_TOKEN: 'fixture-token',
      },
    });
    const calls: string[][] = fs.existsSync(path.join(root, 'calls.jsonl'))
      ? fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    return { result, calls, restored: fs.readFileSync(path.join(root, 'package.json'), 'utf8') === manifest };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const kind of ['preview', 'mirror'] as const) {
  test(`${kind} skips only a verified existing artifact`, () => {
    const { result, calls, restored } = execute(kind, { initial: metadata });
    expect(result.status, result.stderr).toBe(0);
    expect(calls.map(args => args[0])).toEqual(['pack', 'view']);
    expect(result.stdout).toContain('already exists');
    expect(restored).toBe(true);
  });

  test.each([
    { ...metadata, gitHead: 'b'.repeat(40) },
    { ...metadata, 'dist.integrity': undefined },
    { ...metadata, 'dist.integrity': `sha512-${Buffer.alloc(64, 1).toString('base64')}` },
    { ...metadata, 'dist.integrity': {} },
    { ...metadata, 'dist.integrity': 'garbage' },
  ])(`${kind} rejects mismatched or incomplete existing metadata`, initial => {
    const { result, calls } = execute(kind, { initial });
    expect(result.status).not.toBe(0);
    expect(calls.map(args => args[0])).toEqual(['pack', 'view']);
  });

  test(`${kind} does not treat unavailable metadata as an absent artifact`, () => {
    const { result, calls } = execute(kind, { readError: 'E503' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('registry lookup failed');
    expect(calls.map(args => args[0])).toEqual(['pack', 'view']);
  });

  test(`${kind} reads back an ambiguous publish without replaying it`, () => {
    const { result, calls, restored } = execute(kind, { publishError: true, accepted: metadata });
    expect(result.status, result.stderr).toBe(0);
    expect(calls.map(args => args[0])).toEqual(['pack', 'view', 'publish', 'view']);
    expect(result.stderr).toContain('publish rejected');
    expect(restored).toBe(true);
  });

  test(`${kind} preserves a publish failure when no matching artifact is confirmed`, () => {
    const { result, calls, restored } = execute(kind, { publishError: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('publish rejected');
    expect(calls.map(args => args[0])).toEqual(['pack', 'view', 'publish', 'view']);
    expect(restored).toBe(true);
  });
}

test.each([false, true])('new preview preserves its OIDC/token authentication path (token=%s)', token => {
  const { result, calls } = execute('preview', {}, token);
  expect(result.status, result.stderr).toBe(0);
  const publish = calls.find(args => args[0] === 'publish')!;
  expect(publish.includes('--provenance')).toBe(!token);
  expect(publish).toContain('next');
});
