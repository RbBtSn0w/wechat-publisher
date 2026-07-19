import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/lib/config';
import { publishDirCommand } from '../src/commands/publish-dir';

vi.mock('../src/lib/config', () => ({
  loadConfig: vi.fn(() => {
    throw new Error('loadConfig should not be called during dry-run');
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

test('publish-dir dry-run validates a local payload without WeChat credentials', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-pub-command-'));
  const draftDir = path.join(cwd, 'draft');
  fs.mkdirSync(draftDir);
  fs.writeFileSync(path.join(draftDir, 'image.png'), 'image');
  fs.writeFileSync(
    path.join(draftDir, 'draft.json'),
    JSON.stringify({
      articles: [
        {
          article_type: 'newspic',
          content: 'hello',
          image_info: {
            image_list: [{ image_media_id: 'local://image.png' }],
          },
        },
      ],
    })
  );
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit(${code})`);
  });

  await publishDirCommand(draftDir, { dryRun: true, config: 'missing.yml' });

  expect(loadConfig).not.toHaveBeenCalled();
  expect(exitSpy).not.toHaveBeenCalled();
});

test('publish-dir reports a missing API client before attempting to add a draft', async () => {
  const draftDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-pub-command-'));
  fs.writeFileSync(
    path.join(draftDir, 'draft.json'),
    JSON.stringify({
      articles: [
        {
          article_type: 'newspic',
          content: 'hello',
          image_info: {
            image_list: [{ image_media_id: 'existing-media-id' }],
          },
        },
      ],
    })
  );
  vi.mocked(loadConfig).mockReturnValue(undefined as never);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation(message => errors.push(String(message)));
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit(${code})`);
  });

  await expect(
    publishDirCommand(draftDir, { dryRun: false, config: 'missing.yml' })
  ).rejects.toThrow(/process\.exit\(1\)/);

  expect(errors.join('\n')).toMatch(/WeChat API client is required/);
});
