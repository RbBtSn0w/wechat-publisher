import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { verifyMarkdownDependency } from '../scripts/markdown-dependency.mjs';

const sdk = '@rbbtsn0w/wechat-markdown';
let root: string;
const writeJson = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value));
const editJson = (file: string, edit: (value: any) => void) => {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(value);
  writeJson(file, value);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-sdk-contract-'));
  writeJson(path.join(root, 'package.json'), {
    name: 'synthetic-consumer', dependencies: { [sdk]: '2.1.3' }, engines: { node: '>=22.14.0' },
  });
  writeJson(path.join(root, 'package-lock.json'), { lockfileVersion: 3, packages: {
    '': { dependencies: { [sdk]: '2.1.3' } },
    [`node_modules/${sdk}`]: { version: '2.1.3' },
  } });
  const installed = path.join(root, 'node_modules', sdk);
  fs.mkdirSync(path.join(installed, 'dist'), { recursive: true });
  writeJson(path.join(installed, 'package.json'), {
    name: sdk, version: '2.1.3', exports: './dist/index.js', engines: { node: '>=22.14.0' },
  });
  fs.writeFileSync(path.join(installed, 'dist/index.js'), 'module.exports = {};');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('verifies the exact SDK loaded by a consumer without changing its lockfile', () => {
  const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  expect(verifyMarkdownDependency(root)).toMatchObject({ name: sdk, version: '2.1.3' });
  expect(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).toBe(lock);
});

test.each(['*', '^2.1.3', 'latest', '2.1.4-beta.1'])('rejects a floating or prerelease SDK requirement: %s', version => {
  editJson(path.join(root, 'package.json'), pkg => { pkg.dependencies[sdk] = version; });
  expect(() => verifyMarkdownDependency(root)).toThrow(/exact stable version/i);
});

test('rejects disagreement between the manifest and lockfile requirement', () => {
  editJson(path.join(root, 'package-lock.json'), lock => { lock.packages[''].dependencies[sdk] = '^2.1.3'; });
  expect(() => verifyMarkdownDependency(root)).toThrow(/lockfile requirement/i);
});

test('rejects a lockfile that resolves a different SDK', () => {
  editJson(path.join(root, 'package-lock.json'), lock => { lock.packages[`node_modules/${sdk}`].version = '2.1.4'; });
  expect(() => verifyMarkdownDependency(root)).toThrow(/locked SDK/i);
});

test('rejects a different SDK installed after tests or a failed update', () => {
  editJson(path.join(root, 'node_modules', sdk, 'package.json'), pkg => { pkg.version = '2.1.4'; });
  expect(() => verifyMarkdownDependency(root)).toThrow(/installed SDK/i);
});

test('rejects a consumer Node range broader than the SDK supports', () => {
  editJson(path.join(root, 'package.json'), pkg => { pkg.engines.node = '>=22.12.0'; });
  expect(() => verifyMarkdownDependency(root)).toThrow(/Node range/i);
});

test('can verify a real installed package without relying on its unpublished lockfile', () => {
  fs.unlinkSync(path.join(root, 'package-lock.json'));
  expect(verifyMarkdownDependency(root, { requireLockfile: false })).toMatchObject({ version: '2.1.3' });
});
