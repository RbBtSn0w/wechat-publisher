import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';
import { latestCommand } from '../src/commands/latest';
import { syncCommand } from '../src/commands/sync';
import { loadConfig } from '../src/lib/config';
import { UnknownWriteOutcomeError } from '../src/lib/api-client';

vi.mock('../src/commands/sync', () => ({ syncCommand: vi.fn() }));
vi.mock('../src/lib/config', () => ({ loadConfig: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); process.exitCode = 0; });

test.each([true, false])('latest stops only for unknown writes (unknown=%s)', async unknown => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-latest-'));
  fs.writeFileSync(path.join(directory, '01.md'), 'First');
  fs.writeFileSync(path.join(directory, '02.md'), 'Second');
  vi.mocked(loadConfig).mockReturnValue({ appId: '', appSecret: '', postsDir: directory, assetsDir: directory });
  vi.mocked(syncCommand).mockRejectedValueOnce(unknown ? new UnknownWriteOutcomeError('Add draft') : new Error('Invalid article'))
    .mockResolvedValue(undefined);
  try {
    await latestCommand('2', {});
    expect(syncCommand).toHaveBeenCalledTimes(unknown ? 1 : 2);
    expect(process.exitCode).toBe(1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
