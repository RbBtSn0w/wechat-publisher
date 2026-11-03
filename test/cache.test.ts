import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { afterEach, expect, test, vi } from 'vitest';
import { ResourceCache } from '../src/lib/cache';

const roots: string[] = [];
const root = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-cache-test-')); roots.push(dir); return dir; };
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

test('separate processes preserve different entries without sharing an in-memory snapshot', async () => {
  const cacheRoot = root();
  const script = `
    const { ResourceCache } = require('./src/lib/cache');
    const cache = new ResourceCache({ cacheRoot: process.argv[1], scope: { appId: 'account' } });
    setTimeout(() => cache.set(process.argv[2], 'https://wechat/' + process.argv[2], 'fp'), 20);
  `;
  const run = promisify(execFile);
  await Promise.all(['first', 'second'].map(key => run(process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-e', script, cacheRoot, key], { cwd: process.cwd() })));
  const cache = new ResourceCache({ cacheRoot, scope: { appId: 'account' } });
  expect(cache.get('first', 'fp')).toBe('https://wechat/first');
  expect(cache.get('second', 'fp')).toBe('https://wechat/second');
});

test('entries persist independently across cache instances with fingerprint and account isolation', () => {
  const cacheRoot = root();
  const options = { cacheRoot, scope: { appId: 'one', baseUrl: 'https://example.com' } };
  const first = new ResourceCache(options);
  const second = new ResourceCache(options);
  first.set('a', 'https://wechat/a', 'a1');
  second.set('b', 'https://wechat/b', 'b1');
  expect(second.get('a', 'a1')).toBe('https://wechat/a');
  expect(first.get('b', 'b1')).toBe('https://wechat/b');
  expect(first.get('a', 'a2')).toBeNull();
  expect(new ResourceCache({ ...options, scope: { appId: 'two', baseUrl: 'https://example.com' } }).get('a')).toBeNull();
  expect(new ResourceCache({ ...options, scope: { appId: 'one', baseUrl: 'https://other.com' } }).get('a')).toBeNull();
  expect(new ResourceCache({ cacheRoot }).get('a')).toBeNull();
  expect(new ResourceCache({ ...options, scope: { appId: 'one', baseUrl: 'https://EXAMPLE.com:443/' } }).get('a', 'a1')).toBe('https://wechat/a');
});

test('single flight shares producers across scoped instances and preserves successful uploads on cache failure', async () => {
  const cacheRoot = root();
  const first = new ResourceCache({ cacheRoot });
  const second = new ResourceCache({ cacheRoot });
  let uploads = 0;
  const producer = async () => { uploads++; await new Promise(resolve => setTimeout(resolve, 5)); return 'https://wechat/result'; };
  expect(await Promise.all([first.getOrUpload('same', 'v1', producer), second.getOrUpload('same', 'v1', producer)])).toEqual(['https://wechat/result', 'https://wechat/result']);
  expect(uploads).toBe(1);
  const blockedRoot = path.join(cacheRoot, 'blocked');
  fs.writeFileSync(blockedRoot, 'file');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const blocked = new ResourceCache({ cacheRoot: blockedRoot });
  await expect(blocked.getOrUpload('secret-key', 'fp', producer)).resolves.toBe('https://wechat/result');
  expect(warn).toHaveBeenCalled();
  expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-key');
});

test('corrupt entries are misses and legacy caches remain untouched', () => {
  const cacheRoot = root();
  const legacy = path.join(cacheRoot, 'wechat-cache.json');
  fs.writeFileSync(legacy, '{"legacy":"retained"}');
  const cache = new ResourceCache({ cacheRoot });
  cache.set('key', 'https://wechat/value', 'fp');
  const files = fs.readdirSync(cacheRoot, { recursive: true }).map(String).filter(name => name.endsWith('.json') && name !== 'wechat-cache.json');
  expect(files).toHaveLength(1);
  fs.writeFileSync(path.join(cacheRoot, files[0]), '{broken');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(cache.get('key', 'fp')).toBeNull();
  expect(fs.readFileSync(legacy, 'utf8')).toBe('{"legacy":"retained"}');
});
