import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyMarkdownDependency } from './markdown-dependency.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-package-smoke-'));
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, npm_config_cache: process.env.NPM_CONFIG_CACHE || path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '2', npm_config_fetch_timeout: '30000' },
});
try {
  const tarball = process.argv[2];
  if (!tarball || !path.isAbsolute(tarball)) throw new Error('Expected an absolute tarball input');
  const expectedSdk = verifyMarkdownDependency(process.cwd());
  const files = run('tar', ['-tzf', tarball]).trim().split('\n').map(file => file.replace(/^package\//, '')).filter(file => file && !file.endsWith('/'));
  if (!files.includes('dist/src/index.js') || !files.includes('dist/bin/wechat-pub.js')) throw new Error('Package entrypoints are missing.');
  if (files.some(file => !/^(?:dist\/|templates\/|skills\/|docs\/|README(?:\.md)?$|LICENSE(?:\..*)?$|package\.json$)/.test(file))) throw new Error('Unexpected package payload.');
  const install = path.join(temporary, 'install');
  fs.mkdirSync(install);
  fs.writeFileSync(path.join(install, 'package.json'), '{"private":true}');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], install);
  const packageRoot = path.join(install, 'node_modules', '@rbbtsn0w', 'wechat-publisher');
  const installedSdk = verifyMarkdownDependency(packageRoot, { requireLockfile: false });
  if (installedSdk.version !== expectedSdk.version) throw new Error('Archive SDK differs from the verified source SDK.');
  run(process.execPath, ['-e', 'require(process.argv[1])', packageRoot], install);
  const cli = path.join(packageRoot, 'dist', 'bin', 'wechat-pub.js');
  for (const args of [['--help'], ['--version'], ['init', '--help'], ['update', '--dry-run'], ['update', '--beta', '--dry-run'], ['update', '--dev', '--dry-run']]) run(process.execPath, [cli, ...args], install);
  for (const asset of ['templates/publish-dir/news/draft.json', 'skills/wechat-publish-news/SKILL.md', 'docs/release-train.md']) {
    if (!fs.existsSync(path.join(packageRoot, asset))) throw new Error(`Packaged asset missing: ${asset}`);
  }
  const draft = path.join(temporary, 'draft');
  fs.mkdirSync(draft);
  fs.writeFileSync(path.join(draft, 'cover.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAC8AAAAUCAIAAACS+POVAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOklEQVRIie2VQQ0AQAzCZgRP1YP6c3HbowkCCIEyKXc06w6iG8ym9iZuCnnTfQrHZ8Bsam/ipvjGmwdD81Bib0fnTQAAAABJRU5ErkJggg==', 'base64'));
  run(process.execPath, [cli, 'init', '--draft', 'news', '--output', draft, '--title', 'Package smoke', '--content', '<p>Content</p>', '--cover', 'cover.png'], install);
  const generated = JSON.parse(fs.readFileSync(path.join(draft, 'draft.json'), 'utf8'));
  if (generated.articles?.[0]?.thumb_media_id !== 'local://cover.png') throw new Error('Installed CLI could not create a portable draft.');
  if (process.env.PREVIEW_VERSION) {
    const entry = path.join(install, 'node_modules', '.bin', 'wechat-pub');
    assert.equal(run(entry, ['--version'], install).trim(), process.env.PREVIEW_VERSION);
    assert.match(run(entry, ['--help'], install), /publish-dir/);

    const offline = path.join(install, 'offline.cjs');
    fs.writeFileSync(offline, `
const denied = () => { throw new Error('Network access is disabled in preview dry-run'); };
for (const protocol of ['node:http', 'node:https']) {
  const transport = require(protocol);
  transport.request = transport.get = denied;
}
const net = require('node:net');
net.Socket.prototype.connect = denied;
globalThis.fetch = denied;
`);
    const output = execFileSync(entry, ['publish-dir', draft, '--dry-run'], {
      cwd: install, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        PATH: process.env.PATH,
        HOME: install,
        TMPDIR: temporary,
        NODE_OPTIONS: '--require=' + JSON.stringify(offline),
      },
    });
    assert.match(output, /--- Dry Run ---[\s\S]+Resolved placeholders: 1/);
    console.log('Exact installed CLI and isolated local dry-run passed.');
  }
  console.log(run(process.execPath, [path.resolve('scripts/package-functional-smoke.cjs'), packageRoot, path.join(temporary, 'functional')], install).trim());
  console.log(`Installed SDK verified: ${installedSdk.name}@${installedSdk.version}`);
  console.log(`Package smoke passed: ${tarball} (${files.length} files).`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
