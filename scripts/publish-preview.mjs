import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import semver from 'semver';
import { publishArtifact } from './publish-registry.mjs';

const [gitHead] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!semver.valid(pkg.version) || !/^[a-f0-9]{40}$/.test(gitHead || '') ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== gitHead) {
  throw new Error('Preview identity does not match the prepared checkout.');
}
publishArtifact(pkg, pkg.version, 'next', gitHead, 'https://registry.npmjs.org/', { provenance: !process.env.NODE_AUTH_TOKEN });
