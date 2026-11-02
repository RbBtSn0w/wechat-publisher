import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { processPostWithReport, preparePostWithReport, executePreparedPost } from '../src/lib/processor';
import { TEMP_PATHS } from '../src/lib/constants';
import { Uploader } from '../src/lib/uploader';

let directory: string;

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-upload-gate-'));
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
  fs.writeFileSync(path.join(directory, 'cover.png'), bytes);
  fs.writeFileSync(path.join(directory, 'body.png'), bytes);
  vi.spyOn(TEMP_PATHS, 'cacheFile', 'get').mockReturnValue(path.join(directory, 'legacy-cache.json'));
  vi.spyOn(TEMP_PATHS, 'base', 'get').mockReturnValue(directory);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(content: string) {
  const post = path.join(directory, 'post.md');
  fs.writeFileSync(post, `---\ntitle: Upload gate\ncover: ${path.join(directory, 'cover.png')}\n---\n${content}`);
  const uploader = {
    uploadImage: vi.fn(async () => 'https://mmbiz.qpic.cn/body.png'),
    uploadPermanentImage: vi.fn(async () => 'cover-id'),
  };
  return { post, uploader, config: { appId: directory, appSecret: '', postsDir: '.', assetsDir: directory } };
}

test('rendered content limits reject before any asset upload', async () => {
  const { post, config, uploader } = fixture(`![body](${path.join(directory, 'body.png')})\nBody text`);
  await expect(processPostWithReport(post, { ...config, limits: { contentCharacters: 1 } }, uploader as unknown as Uploader))
    .rejects.toThrow(/content exceeds/i);
  expect(uploader.uploadImage).not.toHaveBeenCalled();
  expect(uploader.uploadPermanentImage).not.toHaveBeenCalled();
});

test('all images are prepared before the first upload', async () => {
  const { post, config, uploader } = fixture(`![body](${path.join(directory, 'body.png')})\n![missing](${path.join(directory, 'missing.png')})`);
  await expect(processPostWithReport(post, config, uploader as unknown as Uploader)).rejects.toThrow(/not found/i);
  expect(uploader.uploadImage).not.toHaveBeenCalled();
  expect(uploader.uploadPermanentImage).not.toHaveBeenCalled();
});

test('invalid image bytes and unresolved prose placeholders reject before upload', async () => {
  fs.writeFileSync(path.join(directory, 'fake.png'), 'not an image');
  for (const content of [`![fake](${path.join(directory, 'fake.png')})`, '[TODO: finish article]']) {
    const { post, config, uploader } = fixture(content);
    await expect(processPostWithReport(post, config, uploader as unknown as Uploader)).rejects.toThrow();
    expect(uploader.uploadImage).not.toHaveBeenCalled();
    expect(uploader.uploadPermanentImage).not.toHaveBeenCalled();
  }
});

test('final URL length is checked before a draft can be written', async () => {
  const { post, config, uploader } = fixture(`![body](${path.join(directory, 'body.png')})`);
  const initial = await preparePostWithReport(post, config);
  const prepared = await preparePostWithReport(post, { ...config, limits: { contentCharacters: initial.result.post.contentHtml.length + 10 } });
  uploader.uploadImage.mockResolvedValue(`https://mmbiz.qpic.cn/${'x'.repeat(2000)}`);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(executePreparedPost(prepared, uploader as unknown as Uploader)).rejects.toThrow(/content exceeds/i);
  expect(uploader.uploadImage).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('1 body image(s)'));
});

test('encoded local image paths are replaced in the final rendered HTML', async () => {
  const image = path.join(directory, 'space & name.png');
  fs.copyFileSync(path.join(directory, 'body.png'), image);
  const { post, config, uploader } = fixture(`![space](<${image}>)`);
  const result = await processPostWithReport(post, config, uploader as unknown as Uploader);
  expect(result.post.contentHtml).toContain('src="https://mmbiz.qpic.cn/body.png"');
  expect(result.post.contentHtml).not.toContain('space%20');
  expect(result.post.contentHtml).not.toContain(directory);
});

test('preparation rejects an upload-incompatible extension even with valid image bytes', async () => {
  fs.copyFileSync(path.join(directory, 'body.png'), path.join(directory, 'disguised.webp'));
  const { post, config } = fixture(`![good](${path.join(directory, 'body.png')})\n![bad](${path.join(directory, 'disguised.webp')})`);
  await expect(preparePostWithReport(post, config)).rejects.toThrow(/format/i);
});
