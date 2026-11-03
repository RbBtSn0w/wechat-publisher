import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { previewBase } from './release-helpers.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const pr = process.env.PR_NUMBER;
const sha = process.env.HEAD_SHA;
if (!/^\d+$/.test(pr || '') || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid preview identity.');
// The PR checkout is untrusted version input; read the manifest and tags from trusted develop.
const manifest = JSON.parse(git('show', 'origin/develop:package.json'));
const tags = [...new Set([
  ...git('tag', '--merged', 'origin/develop').split('\n'),
  ...git('tag', '--merged', 'origin/main').split('\n'),
])];
const version = `${previewBase(manifest.version, tags)}-dev.pr${pr}.${sha.slice(0, 7)}`;
execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts'], { stdio: 'inherit' });
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `dev_version=${version}\n`);
