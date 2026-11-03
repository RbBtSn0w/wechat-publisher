import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { exportCommand } from '../src/commands/export';
import { decodeHtmlEntities, normalizeLinksAndFootnotes, neuterLinksToSpans } from '../src/lib/converter';
import { runPreflightCheck } from '../src/lib/preflight';
import { readPortableImage, validateUploadableImage } from '../src/lib/media';
import { resolveDraftPayloadMedia } from '../src/lib/directory-draft';
import { ResourceCache } from '../src/lib/cache';
import { Uploader } from '../src/lib/uploader';
import { WeChatAPIClient } from '../src/lib/api-client';
import { validPng } from './helpers/image';
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-review-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
test('uppercase HTML entities decode exactly once', () => {
  expect(decodeHtmlEntities('&AMP; &LT; &GT; &QUOT; &amp;lt;')).toBe('& < > " &lt;');
});
test('single quoted external links become spans and footnotes; internal links remain clickable', () => {
  const html = "<a href='https://example.com?a=1&AMP;b=2'>Docs</a><a href='https://mp.weixin.qq.com/s/id'>Internal</a>";
  const result = normalizeLinksAndFootnotes(html);
  expect(result.footnotes[0].href).toBe('https://example.com?a=1&b=2');
  expect(result.html).not.toContain("href='https://example.com");
  expect(neuterLinksToSpans(html)).not.toContain("href='https://example.com");
  expect(result.html).toContain("href='https://mp.weixin.qq.com");
});
test('strict directory export rejects a declared missing cover', async () => {
  fs.writeFileSync(path.join(dir, 'post.md'), '---\ncover: missing.png\n---\nBody');
  await expect(exportCommand(dir, { strict: true })).rejects.toThrow(/Preflight/);
});
test.each(['diagram%20one.png', 'literal%2520.png'])('HTML draft decodes image URI %s with literal fallback', async resource => {
  fs.writeFileSync(path.join(dir, resource === 'diagram%20one.png' ? 'diagram one.png' : resource), validPng);
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify({ articles: [{ content: `<img src="${resource}">`, thumb_media_id: 'existing' }] }));
  const output = path.join(dir, 'out.html');
  await exportCommand(dir, { output });
  expect(fs.readFileSync(output, 'utf8')).toContain('data:image/png;base64,');
});
test.each([false, true])('export preserves source bytes including directory mode (%s)', async directory => {
  const source = path.join(dir, 'post.md');
  fs.writeFileSync(source, '# Original markdown');
  await expect(exportCommand(directory ? dir : source, { output: source })).rejects.toThrow(/source/i);
  expect(fs.readFileSync(source, 'utf8')).toBe('# Original markdown');
});
test('export rejects multi article draft rather than dropping later articles', async () => {
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify({ articles: [{ content: 'First' }, { content: 'Second' }] }));
  await expect(exportCommand(dir)).rejects.toThrow(/one article/i);
});
test.each(['png', 'svg', 'jpg', 'webp', 'gif'])('portable %s size guard precedes reading bytes', async extension => {
  const file = path.join(dir, `large.${extension}`); fs.writeFileSync(file, 'x'); fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const read = vi.spyOn(fs, 'readFileSync');
  await expect(readPortableImage(file)).rejects.toThrow(/64 MiB/);
  expect(read).not.toHaveBeenCalled();
});
test('upload size guard precedes reading bytes', async () => {
  const file = path.join(dir, 'large.png'); fs.writeFileSync(file, 'x'); fs.truncateSync(file, 3 * 1024 * 1024);
  const read = vi.spyOn(fs, 'readFileSync');
  await expect(validateUploadableImage(file)).rejects.toThrow(/upload limit/);
  expect(read).not.toHaveBeenCalled();
});
test('nested tag quoted code closer does not end protected HTML', async () => {
  const result = await runPreflightCheck({ content: '<code><span title="</code>">[TODO]</span></code>', markdownInline: false });
  expect(result.passed).toBe(true);
});
test('inline code continues across block quote lines', async () => {
  const result = await runPreflightCheck({ content: '> `example\n> [TODO]`' });
  expect(result.passed).toBe(true);
});
test('source placeholder does not hide another rendered occurrence', async () => {
  const result = await runPreflightCheck({ sourceMarkdown: '[TODO](https://example.com)\n\n&#91;TODO&#93;', content: '<a>TODO</a>\n<p>[TODO]</p>' });
  expect(result.issues).toHaveLength(2);
});
test('long placeholder filename does not reject payload fitting actual CDN URL', async () => {
  const name = `${'x'.repeat(170)}.png`; fs.writeFileSync(path.join(dir, name), validPng);
  const content = `<img src="local://${name}">`;
  const payload = { articles: [{ title: 'Post', content, thumb_media_id: 'existing' }] };
  const uploader = { uploadImage: vi.fn(async () => 'https://cdn/x'), uploadPermanentImage: vi.fn() };
  const result = await resolveDraftPayloadMedia(payload, { directory: dir, cache: new ResourceCache({ cacheRoot: path.join(dir, 'cache') }), dryRun: false, uploader: uploader as unknown as Uploader, limits: { contentCharacters: 50 } });
  expect(result.payload.articles[0].content).toBe('<img src="https://cdn/x">');
});
test('uploader retains verified bytes across access token await', async () => {
  const file = path.join(dir, 'image.png'); fs.writeFileSync(file, validPng);
  let uploaded: Buffer | undefined;
  const api = { getAccessToken: vi.fn(async () => { fs.writeFileSync(file, 'changed after validation'); return 'token'; }), postMultipart: vi.fn(async (_url, make) => {
    const form = make().body;
    uploaded = await new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; form.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk))); form.on('end', () => resolve(Buffer.concat(chunks))); form.on('error', reject); form.resume(); });
    return { data: { url: 'https://cdn/image' } };
  }) };
  await new Uploader(api as unknown as WeChatAPIClient).uploadImage(file);
  expect(uploaded?.includes(validPng)).toBe(true);
  expect(uploaded?.includes(Buffer.from('changed after validation'))).toBe(false);
});

test('deduplication cannot discard a second placeholder on the same rendered line', async () => {
  const result = await runPreflightCheck({ sourceMarkdown: '[TODO] and &#91;TODO&#93;', content: '<p>[TODO] and [TODO]</p>' });
  expect(result.issues.length).toBeGreaterThanOrEqual(2);
});
