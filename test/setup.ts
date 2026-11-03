import { afterAll, vi } from 'vitest';

const { directory } = vi.hoisted(() => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  return { directory: fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-test-state-')) };
});

vi.mock('../src/lib/constants', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/constants')>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const child = (name: string) => {
    const target = path.join(directory, name);
    fs.mkdirSync(target, { recursive: true });
    return target;
  };
  return { ...actual, TEMP_PATHS: {
    get base() { return directory; },
    get cacheFile() { return path.join(directory, 'legacy-cache.json'); },
    get debug() { return child('debug'); },
    get mermaid() { return child('mermaid'); },
    get formula() { return child('formula'); },
    get remoteImage() { return child('remote'); },
  } };
});

afterAll(async () => {
  const fs = await import('node:fs');
  fs.rmSync(directory, { recursive: true, force: true });
});
