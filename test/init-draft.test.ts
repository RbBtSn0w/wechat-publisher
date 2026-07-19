import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';
import {
  completeDraftInitOptions,
  initializeDraftDirectory,
} from '../src/lib/draft-initializer';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-pub-init-draft-'));
}

test('initializeDraftDirectory creates a newspic payload from images in filename order', () => {
  const outputDir = makeTempDir();
  fs.writeFileSync(path.join(outputDir, '02.png'), 'image');
  fs.writeFileSync(path.join(outputDir, '01.jpg'), 'image');
  fs.writeFileSync(path.join(outputDir, 'notes.txt'), 'ignore');

  const result = initializeDraftDirectory({
    draft: 'newspic',
    output: outputDir,
    title: 'Gallery',
    author: 'Author',
    content: 'Caption',
    needOpenComment: false,
    onlyFansCanComment: false,
  });

  expect(result.imageFiles).toEqual(['01.jpg', '02.png']);
  expect(JSON.parse(fs.readFileSync(result.payloadPath, 'utf8'))).toEqual({
    articles: [
      {
        article_type: 'newspic',
        title: 'Gallery',
        author: 'Author',
        content: 'Caption',
        image_info: {
          image_list: [
            { image_media_id: 'local://01.jpg' },
            { image_media_id: 'local://02.png' },
          ],
        },
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  });
});

test('initializeDraftDirectory creates a news payload with a selected local cover', () => {
  const outputDir = makeTempDir();
  fs.writeFileSync(path.join(outputDir, 'cover.png'), 'image');

  const result = initializeDraftDirectory({
    draft: 'news',
    output: outputDir,
    title: 'Article',
    author: 'Author',
    digest: 'Summary',
    content: '<p>Body</p>',
    cover: 'cover.png',
    needOpenComment: true,
    onlyFansCanComment: true,
  });

  expect(JSON.parse(fs.readFileSync(result.payloadPath, 'utf8'))).toEqual({
    articles: [
      {
        article_type: 'news',
        title: 'Article',
        author: 'Author',
        digest: 'Summary',
        content: '<p>Body</p>',
        thumb_media_id: 'local://cover.png',
        need_open_comment: 1,
        only_fans_can_comment: 1,
      },
    ],
  });
});

test('initializeDraftDirectory refuses to overwrite an existing payload without force', () => {
  const outputDir = makeTempDir();
  fs.writeFileSync(path.join(outputDir, 'image.png'), 'image');
  fs.writeFileSync(path.join(outputDir, 'draft.json'), '{"keep":true}');

  expect(() =>
    initializeDraftDirectory({
      draft: 'newspic',
      output: outputDir,
      title: 'Gallery',
      content: 'Caption',
      needOpenComment: false,
      onlyFansCanComment: false,
    })
  ).toThrow(/already exists.*--force/i);

  expect(fs.readFileSync(path.join(outputDir, 'draft.json'), 'utf8')).toBe('{"keep":true}');
});

test('completeDraftInitOptions asks for missing newspic content and confirms image order', async () => {
  const outputDir = makeTempDir();
  fs.writeFileSync(path.join(outputDir, '02.png'), 'image');
  fs.writeFileSync(path.join(outputDir, '01.png'), 'image');
  const answers = ['Gallery', 'Caption', 'yes'];

  const completed = await completeDraftInitOptions(
    {
      draft: 'newspic',
      output: outputDir,
      author: 'Author',
    },
    {
      interactive: true,
      ask: async () => answers.shift() ?? '',
    }
  );

  expect(completed.title).toBe('Gallery');
  expect(completed.content).toBe('Caption');
  expect(completed.images).toEqual(['01.png', '02.png']);
  expect(answers).toEqual([]);
});

test('completeDraftInitOptions reports missing flags in non-interactive mode', async () => {
  await expect(
    completeDraftInitOptions(
      { draft: 'news', output: makeTempDir() },
      { interactive: false, ask: async () => '' }
    )
  ).rejects.toThrow(/--title.*--content.*--cover/);
});

test('initializeDraftDirectory rejects image paths outside the draft directory', () => {
  const outputDir = makeTempDir();
  const outside = path.join(path.dirname(outputDir), 'outside.png');
  fs.writeFileSync(outside, 'image');

  expect(() =>
    initializeDraftDirectory({
      draft: 'newspic',
      output: outputDir,
      title: 'Gallery',
      content: 'Caption',
      images: ['../outside.png'],
      needOpenComment: false,
      onlyFansCanComment: false,
    })
  ).toThrow(/outside the draft directory/i);
});
