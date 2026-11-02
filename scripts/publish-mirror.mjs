import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import semver from 'semver';

const [version, channel, gitHead] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!semver.valid(version) || pkg.version !== version || !['latest', 'beta', 'next'].includes(channel)) throw new Error('Mirror release identity does not match the prepared package.');
if (!/^[a-f0-9]{40}$/.test(gitHead || '') || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== gitHead) throw new Error('Mirror commit identity does not match the prepared checkout.');
if (!process.env.GITHUB_TOKEN) throw new Error('GitHub Packages token is required.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-mirror-'));
const npmrc = path.join(temporary, '.npmrc');
const original = fs.readFileSync('package.json', 'utf8');
try {
  fs.writeFileSync(npmrc, '//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}\n', { mode: 0o600 });
  // npm's publishConfig overrides registry defaults: explicitly prepare the mirror target.
  pkg.publishConfig = { ...pkg.publishConfig, registry: 'https://npm.pkg.github.com' };
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  execFileSync('npm', ['publish', '--registry', 'https://npm.pkg.github.com', '--tag', channel, '--access', 'public', '--userconfig', npmrc], { stdio: 'inherit' });
} finally {
  fs.writeFileSync('package.json', original);
  fs.rmSync(temporary, { recursive: true, force: true });
}
