import { validPng } from './helpers/image';
import { expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ResourceCache } from '../src/lib/cache';
import { vi } from 'vitest';
import {
  discoverDraftDirectories,
  readDraftPayloadFromDirectory,
  resolveDraftPayloadMedia,
} from '../src/lib/directory-draft';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-pub-draft-'));
}

test('readDraftPayloadFromDirectory requires exactly one json', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'a.json'), '{"articles":[{"content":"x","thumb_media_id":"m"}]}');
  fs.writeFileSync(path.join(dir, 'b.json'), '{"articles":[{"content":"x","thumb_media_id":"m"}]}');
  expect(() => readDraftPayloadFromDirectory(dir)).toThrow(/Expected exactly one JSON file/);
});

test('resolveDraftPayloadMedia dry-run resolves local placeholders', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'cover.png'), validPng);
  fs.writeFileSync(path.join(dir, 'body.png'), validPng);

  const payload = {
    articles: [
      {
        article_type: 'news',
        content: '<p><img src="local://body.png"></p>',
        thumb_media_id: 'local://cover.png',
      },
    ],
  };

  const { payload: resolved, stats } = await resolveDraftPayloadMedia(payload, {
    directory: dir,
    cache: new ResourceCache({ cacheRoot: path.join(os.tmpdir(), 'wechat-draft-test-cache', path.basename(makeTempDir())) }),
    dryRun: true,
  });

  expect(String(resolved.articles[0].thumb_media_id)).toContain('DRYRUN_MEDIA_ID_cover.png');
  expect(String(resolved.articles[0].content)).toContain('DRYRUN_URL_body.png');
  expect(stats.placeholderCount).toBe(2);
  expect(stats.permanentUploadCount).toBe(0);
  expect(stats.contentUploadCount).toBe(0);
});

test('resolveDraftPayloadMedia resolves newspic media ids with cache reuse', async () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'a.png'), validPng);

  const uploader = {
    permUploads: 0,
    async uploadPermanentImage(localPath: string): Promise<string> {
      this.permUploads += 1;
      return `MID_${path.basename(localPath)}`;
    },
    async uploadImage(localPath: string): Promise<string> {
      return `URL_${path.basename(localPath)}`;
    },
  };

  const payload = {
    articles: [
      {
        article_type: 'newspic',
        content: 'hello',
        image_info: {
          image_list: [
            { image_media_id: 'local://a.png' },
            { image_media_id: 'local://a.png' },
          ],
        },
      },
    ],
  };

  const { payload: resolved, stats } = await resolveDraftPayloadMedia(payload, {
    directory: dir,
    cache: new ResourceCache({ cacheRoot: path.join(os.tmpdir(), 'wechat-draft-test-cache', path.basename(makeTempDir())) }),
    uploader: uploader as any,
    dryRun: false,
  });

  const imageList = (resolved.articles[0].image_info as any).image_list;
  expect(imageList[0].image_media_id).toBe('MID_a.png');
  expect(imageList[1].image_media_id).toBe('MID_a.png');
  expect(uploader.permUploads).toBe(1);
  expect(stats.permanentUploadCount).toBe(1);
});

test('resolveDraftPayloadMedia enforces news thumb_media_id', async () => {
  const payload = {
    articles: [
      {
        article_type: 'news',
        content: 'abc',
      },
    ],
  };

  await expect(
    resolveDraftPayloadMedia(payload, {
      directory: makeTempDir(),
      cache: new ResourceCache({ cacheRoot: path.join(os.tmpdir(), 'wechat-draft-test-cache', path.basename(makeTempDir())) }),
      dryRun: true,
    })
  ).rejects.toThrow(/thumb_media_id/);
});

test('discoverDraftDirectories finds single directory or subdirectories', () => {
  const root = makeTempDir();
  const sub1 = path.join(root, '01-draft');
  const sub2 = path.join(root, '02-draft');
  fs.mkdirSync(sub1);
  fs.mkdirSync(sub2);
  fs.writeFileSync(path.join(sub1, 'draft.json'), '{"articles":[]}');
  fs.writeFileSync(path.join(sub2, 'draft.json'), '{"articles":[]}');

  const dirs = discoverDraftDirectories(root);
  expect(dirs).toEqual([sub1, sub2]);

  // If pointing to sub1 directly, returns [sub1]
  expect(discoverDraftDirectories(sub1)).toEqual([sub1]);
});

test('real resolution validates every article before any upload and preserves code examples', async () => {
  const directory = makeTempDir();
  fs.writeFileSync(path.join(directory, 'valid.png'), validPng);
  const uploader = { uploadImage: vi.fn(async () => 'https://wechat/image'), uploadPermanentImage: vi.fn(async () => 'media') };
  const options = { directory, cache: new ResourceCache({ cacheRoot: path.join(directory, 'cache') }), uploader: uploader as never, dryRun: false };
  await expect(resolveDraftPayloadMedia({ articles: [
    { content: '<img src="local://valid.png">', thumb_media_id: 'existing' },
    { content: 'Second article', thumb_media_id: 'local://missing.png' },
  ] }, options)).rejects.toThrow();
  expect(uploader.uploadImage).not.toHaveBeenCalled();
  expect(uploader.uploadPermanentImage).not.toHaveBeenCalled();
  const result = await resolveDraftPayloadMedia({ articles: [
    { content: '<pre><code>local://example.png</code></pre><img src="local://valid.png">', thumb_media_id: 'existing' },
  ] }, { ...options, dryRun: true });
  expect(result.payload.articles[0].content).toContain('<code>local://example.png</code>');
});

