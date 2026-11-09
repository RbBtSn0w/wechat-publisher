import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';

test('the package runner selects npm 12 or newer inside the publisher process', () => {
  const version = execFileSync('npx', ['--no-install', '--call', 'npm --version'], {
    encoding: 'utf8', timeout: 30000,
  }).trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number(version.split('.')[0]) >= 12, `Publisher selected npm ${version}`);
});
