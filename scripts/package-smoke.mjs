import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-package-smoke-'));
const run = (command, args, cwd = process.cwd()) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0', npm_config_fetch_timeout: '30000' },
});
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary]));
  const files = packed.files.map(file => file.path);
  if (!files.includes('dist/src/index.js') || !files.includes('dist/bin/wechat-pub.js')) throw new Error('Package entrypoints are missing.');
  if (files.some(file => !/^(?:dist\/|templates\/|skills\/|docs\/|README(?:\.md)?$|LICENSE(?:\..*)?$|package\.json$)/.test(file))) throw new Error('Unexpected package payload.');
  const install = path.join(temporary, 'install');
  fs.mkdirSync(install);
  fs.writeFileSync(path.join(install, 'package.json'), '{"private":true}');
  run('npm', ['install', '--no-audit', '--no-fund', path.join(temporary, packed.filename)], install);
  const packageRoot = path.join(install, 'node_modules', '@rbbtsn0w', 'wechat-publisher');
  run(process.execPath, ['-e', 'require(process.argv[1])', packageRoot], install);
  const cli = path.join(packageRoot, 'dist', 'bin', 'wechat-pub.js');
  for (const args of [['--help'], ['--version'], ['init', '--help'], ['update', '--dry-run'], ['update', '--beta', '--dry-run'], ['update', '--dev', '--dry-run']]) run(process.execPath, [cli, ...args], install);
  for (const asset of ['templates/publish-dir/news/draft.json', 'skills/wechat-publish-news/SKILL.md', 'docs/release-train.md']) {
    if (!fs.existsSync(path.join(packageRoot, asset))) throw new Error(`Packaged asset missing: ${asset}`);
  }
  const draft = path.join(temporary, 'draft');
  fs.mkdirSync(draft);
  fs.writeFileSync(path.join(draft, 'cover.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDl8AAAAASUVORK5CYII=', 'base64'));
  run(process.execPath, [cli, 'init', '--draft', 'news', '--output', draft, '--title', 'Package smoke', '--content', '<p>Content</p>', '--cover', 'cover.png'], install);
  const generated = JSON.parse(fs.readFileSync(path.join(draft, 'draft.json'), 'utf8'));
  if (generated.articles?.[0]?.thumb_media_id !== 'local://cover.png') throw new Error('Installed CLI could not create a portable draft.');
  console.log(`Package smoke passed: ${packed.filename} (${files.length} files).`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
