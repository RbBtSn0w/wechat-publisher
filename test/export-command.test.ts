import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exportCommand } from '../src/commands/export';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';

describe('exportCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-pub-export-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('exports single markdown post to output HTML with inlined styles and Jekyll attribute normalization', async () => {
    const mdFile = path.join(tmpDir, 'test.md');
    fs.writeFileSync(
      mdFile,
      `---
title: Test Post
---
# Hello World

Here is an [External Link](https://example.com/demo){:target="_blank"}.

\`\`\`swift
// [TODO: inside code block should not trigger preflight error]
let url = "local://inside-code.png"
\`\`\`
`
    );

    const outFile = path.join(tmpDir, 'output.html');
    await exportCommand(mdFile, { output: outFile, strict: true });

    expect(fs.existsSync(outFile)).toBe(true);
    const html = fs.readFileSync(outFile, 'utf8');
    expect(html).toContain('External Link');
    expect(html).toContain('参考链接');
    expect(html).toContain('https://example.com/demo');
    expect(html).not.toContain('{:target="_blank"}');
    expect(html).not.toContain('<a href="https://example.com/demo"');
  });

  it('exports draft.json directory without double-rendering HTML and blocks path traversal', async () => {
    const draftDir = path.join(tmpDir, 'my-draft');
    fs.mkdirSync(draftDir);

    const coverPath = path.join(draftDir, 'cover.png');
    await sharp({
      create: { width: 940, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toFile(coverPath);

    const bodyImgPath = path.join(draftDir, 'diagram.png');
    fs.writeFileSync(bodyImgPath, 'png-bytes');

    const preRenderedHtml = `<section class="custom-wrapper"><p>Pre-rendered <a href="https://example.com/ref">Reference</a> and <img src="local://diagram.png"></p></section>`;
    fs.writeFileSync(
      path.join(draftDir, 'draft.json'),
      JSON.stringify({
        articles: [
          {
            article_type: 'news',
            title: 'Dir Draft',
            thumb_media_id: 'local://cover.png',
            content: preRenderedHtml,
          },
        ],
      })
    );

    const outFile = path.join(tmpDir, 'dir-out.html');
    await exportCommand(draftDir, { output: outFile, strict: true });

    const html = fs.readFileSync(outFile, 'utf8');
    expect(html).toContain('<section class="custom-wrapper">');
    expect(html).toContain(bodyImgPath);
    expect(html).not.toContain('local://diagram.png');
    expect(html).toContain('https://example.com/ref');
  });

  it('rejects path traversal in draft.json local:// placeholder during export', async () => {
    const draftDir = path.join(tmpDir, 'bad-draft');
    fs.mkdirSync(draftDir);
    fs.writeFileSync(
      path.join(draftDir, 'draft.json'),
      JSON.stringify({
        articles: [
          {
            article_type: 'news',
            title: 'Bad Draft',
            thumb_media_id: 'local://../../etc/passwd',
            content: '<p>Hello</p>',
          },
        ],
      })
    );

    await expect(exportCommand(draftDir, { strict: true })).rejects.toThrow(
      /Local placeholder path escapes directory/
    );
  });

  it('throws when strict mode encounters unresolved TODO placeholders in prose', async () => {
    const mdFile = path.join(tmpDir, 'todo.md');
    fs.writeFileSync(
      mdFile,
      `---
title: Todo Post
---
# Draft Article
[TODO: Need more content here]
`
    );

    const outFile = path.join(tmpDir, 'todo-out.html');
    await expect(exportCommand(mdFile, { output: outFile, strict: true })).rejects.toThrow(
      /Preflight checks failed/
    );

    expect(fs.existsSync(outFile)).toBe(false);
  });
});
