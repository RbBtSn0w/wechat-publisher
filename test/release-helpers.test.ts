import { expect, test } from 'vitest';
import { previewBase, releaseOutput, issueReferences } from '../scripts/release-helpers.mjs';

test('preview derives the maximum trusted manifest or stable/beta tag base and ignores preview tags', () => {
  expect(previewBase('1.4.0-beta.1', ['v2.0.0-beta.3', 'v1.7.0', 'v99.0.0-dev.pr4.abcd', 'garbage'])).toBe('2.0.0');
  expect(previewBase('3.0.0-beta.1', ['v2.0.0'])).toBe('3.0.0');
});

test('structured release results distinguish no-op and exact stable/beta releases', () => {
  expect(releaseOutput(false)).toEqual({ released: false, version: '', channel: '' });
  expect(releaseOutput({ nextRelease: { version: '2.0.0' } })).toEqual({ released: true, version: '2.0.0', channel: 'latest' });
  expect(releaseOutput({ nextRelease: { version: '2.1.0-beta.1', channel: 'beta' } })).toEqual({ released: true, version: '2.1.0-beta.1', channel: 'beta' });
  expect(() => releaseOutput({ nextRelease: { version: 'invalid' } })).toThrow();
});

test('promotion preserves linked and textual issue references without duplicates', () => {
  expect(issueReferences('Fixes #3, #4\nCloses #3\nresolves: #8', [{ number: 6 }, { number: 3 }])).toEqual([3, 4, 6, 8]);
});

test('mirror publish failures remain failures and restore the prepared manifest', async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const { spawnSync } = await import('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-mirror-test-'));
  try {
    const pkg = { name: '@scope/pkg', version: '2.0.0', publishConfig: { registry: 'https://registry.npmjs.org' } };
    const original = JSON.stringify(pkg);
    fs.writeFileSync(path.join(root, 'package.json'), original);
    const fakeNpm = path.join(root, 'npm');
    fs.writeFileSync(fakeNpm, '#!/bin/sh\necho "registry unavailable" >&2\nexit 23\n', { mode: 0o755 });
    const gitHead = 'a'.repeat(40);
    fs.writeFileSync(path.join(root, 'git'), `#!/bin/sh\necho '${gitHead}'\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [path.resolve('scripts/publish-mirror.mjs'), '2.0.0', 'latest', gitHead], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, GITHUB_TOKEN: 'test-token' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('registry unavailable');
    expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(original);
    const mismatched = spawnSync(process.execPath, [path.resolve('scripts/publish-mirror.mjs'), '2.0.0', 'latest', 'b'.repeat(40)], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, GITHUB_TOKEN: 'test-token' },
    });
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain('Mirror commit identity does not match');
    expect(mismatched.stderr).not.toContain('registry unavailable');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
