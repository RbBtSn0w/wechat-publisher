import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';
import { fingerprintFile, ResourceCache } from '../src/lib/cache';

test('ResourceCache ignores an entry when the source fingerprint changes', () => {
  const file = path.join(os.tmpdir(), `wechat-cache-${Date.now()}.png`);
  fs.writeFileSync(file, 'first');
  const cache = new ResourceCache();
  const key = `test:${file}`;
  const firstFingerprint = fingerprintFile(file);
  cache.set(key, 'https://wechat/first', firstFingerprint);

  expect(cache.get(key, firstFingerprint)).toBe('https://wechat/first');
  fs.writeFileSync(file, 'second');
  expect(cache.get(key, fingerprintFile(file))).toBeNull();
  fs.unlinkSync(file);
});
