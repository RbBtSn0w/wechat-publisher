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

test('ordinary relative images survive an assets directory with spaces and parentheses', async () => {
  const assets = path.join(directory, 'My Blog (drafts)');
  fs.mkdirSync(assets);
  fs.copyFileSync(path.join(directory, 'body.png'), path.join(assets, 'body.png'));
  fs.copyFileSync(path.join(directory, 'cover.png'), path.join(assets, 'cover.png'));
  const { post, config, uploader } = fixture('![body](body.png)');
  fs.writeFileSync(post, fs.readFileSync(post, 'utf8').replace(path.join(directory, 'cover.png'), path.join(assets, 'cover.png')));
  const result = await processPostWithReport(post, { ...config, assetsDir: assets }, uploader as unknown as Uploader);
  expect(result.post.contentHtml).toContain('src="https://mmbiz.qpic.cn/body.png"');
  expect(result.post.contentMarkdown).toContain('https://mmbiz.qpic.cn/body.png');
  expect(uploader.uploadImage).toHaveBeenCalledTimes(1);
});

test('image references not bound by preparation fail before any upload', async () => {
  const { post, config, uploader } = fixture('![body][figure]\n\n[figure]: body.png');
  await expect(processPostWithReport(post, config, uploader as unknown as Uploader)).rejects.toThrow(/image reference/i);
  expect(uploader.uploadImage).not.toHaveBeenCalled();
  expect(uploader.uploadPermanentImage).not.toHaveBeenCalled();
});

test('preparation rejects an upload-incompatible extension even with valid image bytes', async () => {
  fs.copyFileSync(path.join(directory, 'body.png'), path.join(directory, 'disguised.webp'));
  const { post, config } = fixture(`![good](${path.join(directory, 'body.png')})\n![bad](${path.join(directory, 'disguised.webp')})`);
  await expect(preparePostWithReport(post, config)).rejects.toThrow(/format/i);
});

test('local path length does not reject a payload that fits after upload', async () => {
  const { post, config, uploader } = fixture('![body](body.png)');
  const initial = await preparePostWithReport(post, config);
  const final = await executePreparedPost(initial, uploader as unknown as Uploader);
  const limited = { ...config, limits: {
    contentCharacters: final.post.contentHtml.length,
    contentBytes: Buffer.byteLength(final.post.contentHtml, 'utf8'),
  } };
  const prepared = await preparePostWithReport(post, limited);
  expect(prepared.result.post.contentHtml.length).toBeGreaterThan(limited.limits.contentCharacters);
  const result = await executePreparedPost(prepared, uploader as unknown as Uploader);
  expect(result.post.contentHtml).toBe(final.post.contentHtml);
});

test('content endpoint rejects oversized images and GIF before any cover or body upload', async () => {
  const body = path.join(directory, 'body.png');
  const bytes = fs.readFileSync(body);
  fs.appendFileSync(body, Buffer.alloc(1024 * 1024 - bytes.length));
  const gif = path.join(directory, 'body.gif');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).gif().toFile(gif);
  for (const file of ['body.png', 'body.gif']) {
    const { post, config, uploader } = fixture(`![body](${file})`);
    await expect(processPostWithReport(post, config, uploader as unknown as Uploader)).rejects.toThrow();
    expect(uploader.uploadImage).not.toHaveBeenCalled();
    expect(uploader.uploadPermanentImage).not.toHaveBeenCalled();
  }
});
