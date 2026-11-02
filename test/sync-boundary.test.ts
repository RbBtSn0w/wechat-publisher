import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { afterEach, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/lib/config';
import { syncCommand } from '../src/commands/sync';
import { WeChatAPIClient } from '../src/lib/api-client';
import { Uploader } from '../src/lib/uploader';
import { validPng } from './helpers/image';

vi.mock('../src/lib/config', () => ({ loadConfig: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

test('declining a duplicate performs no uploads or draft writes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-cancel-'));
  fs.writeFileSync(path.join(directory, 'image.png'), validPng);
  const post = path.join(directory, 'post.md');
  fs.writeFileSync(post, `---\ntitle: Existing\ncover: ${path.join(directory, 'image.png')}\n---\nBody`);
  vi.mocked(loadConfig).mockReturnValue({ appId: directory, appSecret: '', postsDir: '.', assetsDir: directory });
  vi.spyOn(WeChatAPIClient.prototype, 'getAllDrafts').mockResolvedValue([
    { media_id: 'existing-id', content: { news_item: [{ title: 'Existing' }] } },
  ]);
  vi.spyOn(readline, 'createInterface').mockReturnValue({
    once: vi.fn(), question: (_query: string, answer: (value: string) => void) => answer('n'), close: vi.fn(),
  } as unknown as readline.Interface);
  const image = vi.spyOn(Uploader.prototype, 'uploadImage');
  const permanent = vi.spyOn(Uploader.prototype, 'uploadPermanentImage');
  const add = vi.spyOn(WeChatAPIClient.prototype, 'addDraft');
  const update = vi.spyOn(WeChatAPIClient.prototype, 'updateDraft');
  try {
    await syncCommand(post, {});
    for (const write of [image, permanent, add, update]) expect(write).not.toHaveBeenCalled();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
