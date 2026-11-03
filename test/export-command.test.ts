import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyRichTextToClipboard } from '../src/lib/clipboard';

vi.mock('../src/lib/clipboard', () => ({
  copyRichTextToClipboard: vi.fn(async () => ({ success: true, platform: 'darwin' })),
}));
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
    vi.restoreAllMocks();
    vi.mocked(copyRichTextToClipboard).mockClear();
    process.exitCode = 0;
  });

  it.each(['[TODO: missing]', '[TBD]'])('rejects a source %s link before file or clipboard output', async placeholder => {
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, `${placeholder}(https://example.com)`);
    const output = path.join(tmpDir, 'rejected.html');

    await expect(exportCommand(source, { output, clip: true, strict: true })).rejects.toThrow(/Preflight checks failed/);

    expect(fs.existsSync(output)).toBe(false);
    expect(copyRichTextToClipboard).not.toHaveBeenCalled();
  });

  it('allows resolved local reference images and placeholder links inside code examples', async () => {
    const image = path.join(tmpDir, 'image.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(image);
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, '![Diagram][figure]\n\n[figure]: local://image.png\n\n```md\n[TODO: example](https://example.com)\n[TBD](https://example.com)\n```\n\n`[TODO: inline](https://example.com)`');
    const output = path.join(tmpDir, 'examples.html');

    await exportCommand(source, { output, strict: true });

    expect(fs.readFileSync(output, 'utf8')).toContain('data:image/png;base64,');
  });

  it.each(['image.png', 'local://image.png'])('only inlines real img attributes while preserving %s examples', async resource => {
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(path.join(tmpDir, 'image.png'));
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, `The filename is image.png.\n\n![Figure][figure]\n\n[figure]: ${resource}\n\n\`${resource}\`\n\n\`\`\`text\n![Example](${resource})\n\`\`\``);
    const output = path.join(tmpDir, 'preserved.html');

    await exportCommand(source, { output, strict: true });

    const html = fs.readFileSync(output, 'utf8');
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(1);
    expect(html).toContain('The filename is image.png.');
    expect(html).toContain(`>${resource}</code>`);
    expect(html).toContain(`![Example](${resource})`);
  });

  it.each(['javascript:alert', 'file:///outside.png', 'custom://image.png'])('rejects unsupported %s image schemes before sanitizer removes them', async resource => {
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, `![Figure][figure]\n\n[figure]: ${resource}`);
    const output = path.join(tmpDir, 'unsupported.html');

    await expect(exportCommand(source, { output })).rejects.toThrow(/Unsupported local image URI/);

    expect(fs.existsSync(output)).toBe(false);
  });

  it('inlines reference images and sends identical final HTML to file and clipboard', async () => {
    const image = path.join(tmpDir, 'diagram.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(image);
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, '![Diagram][figure]\n\n[figure]: diagram.png "Figure"\n\n[Source](https://example.com)');
    const output = path.join(tmpDir, 'out.html');

    await exportCommand(source, { output, clip: true, strict: true });

    const html = fs.readFileSync(output, 'utf8');
    expect(html).toContain(`data:image/png;base64,${fs.readFileSync(image).toString('base64')}`);
    expect(html).not.toContain('src="diagram.png"');
    expect(html).toContain('参考链接');
    expect(copyRichTextToClipboard).toHaveBeenLastCalledWith(html);
  });

  it('inlines SDK-encoded local image paths with spaces', async () => {
    const image = path.join(tmpDir, 'diagram one.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(image);
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, '![Diagram](<diagram one.png>)');
    const output = path.join(tmpDir, 'spaces.html');

    await exportCommand(source, { output });

    expect(fs.readFileSync(output, 'utf8')).toContain('data:image/png;base64,');
  });

  it('inlines a reference image with a literal percent in its filename', async () => {
    const image = path.join(tmpDir, '100%diagram.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(image);
    const source = path.join(tmpDir, 'post.md');
    fs.writeFileSync(source, '![Diagram][figure]\n\n[figure]: 100%diagram.png');
    const output = path.join(tmpDir, 'percent.html');

    await exportCommand(source, { output });

    expect(fs.readFileSync(output, 'utf8')).toContain(`data:image/png;base64,${fs.readFileSync(image).toString('base64')}`);
  });

  it('rejects URI-encoded traversal in a reference image before output', async () => {
    const draft = path.join(tmpDir, 'draft');
    fs.mkdirSync(draft);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(path.join(tmpDir, 'outside.png'));
    const source = path.join(draft, 'post.md');
    fs.writeFileSync(source, '![Diagram][figure]\n\n[figure]: %2e%2e%2foutside.png');
    const output = path.join(tmpDir, 'rejected.html');

    await expect(exportCommand(source, { output })).rejects.toThrow(/escapes directory/);

    expect(fs.existsSync(output)).toBe(false);
  });

  it('uses project roots for Jekyll paths and leaves reference image code examples unchanged', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const posts = path.join(tmpDir, '_posts');
    fs.mkdirSync(posts);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(path.join(tmpDir, 'a&b.png'));
    const source = path.join(posts, 'post.md');
    fs.writeFileSync(source, '![Root][figure]\n\n[figure]: /a&b.png\n\n```md\n![Example][secret]\n\n[secret]: ../missing.png\n```');
    const output = path.join(tmpDir, 'root.html');

    await exportCommand(source, { output, strict: true });

    const html = fs.readFileSync(output, 'utf8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('../missing.png');
    expect(html).toContain('Example');
  });

  it.each(['traversal', 'symlink', 'corrupt', 'local-traversal', 'local-symlink', 'local-corrupt'])('rejects a %s reference image before output', async kind => {
    const failure = kind.replace('local-', '');
    const draft = path.join(tmpDir, 'draft');
    fs.mkdirSync(draft);
    const outside = path.join(tmpDir, 'outside.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(outside);
    let destination = '../outside.png';
    if (failure === 'symlink') {
      destination = 'image.png';
      fs.symlinkSync(outside, path.join(draft, destination));
    } else if (failure === 'corrupt') {
      destination = 'image.png';
      fs.writeFileSync(path.join(draft, destination), 'not an image');
    }
    const source = path.join(draft, 'post.md');
    fs.writeFileSync(source, `![Diagram][figure]\n\n[figure]: ${kind.startsWith('local-') ? 'local://' : ''}${destination}`);
    const output = path.join(tmpDir, 'rejected.html');
    vi.mocked(copyRichTextToClipboard).mockClear();

    await expect(exportCommand(source, { output, clip: true })).rejects.toThrow(
      failure === 'traversal' ? /escapes directory/ : failure === 'symlink' ? /outside directory/ : /unsupported image format/i
    );
    expect(fs.existsSync(output)).toBe(false);
    expect(copyRichTextToClipboard).not.toHaveBeenCalled();
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
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(bodyImgPath);

    const preRenderedHtml = '<section class="custom-wrapper"><p>Press the ` key</p><p>Pre-rendered <a href="https://example.com/ref">Reference</a> and <img src="local://diagram.png"></p><p>then ` again</p></section>';
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
    expect(html).toContain('data:image/png;base64,');
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

  it('rejects external symlink target in draft.json local:// placeholder (canonical containment)', async () => {
    const draftDir = path.join(tmpDir, 'symlink-draft');
    fs.mkdirSync(draftDir);

    const outsideFile = path.join(tmpDir, 'outside-secret.png');
    fs.writeFileSync(outsideFile, 'secret');

    const symlinkPath = path.join(draftDir, 'symlink.png');
    fs.symlinkSync(outsideFile, symlinkPath);

    fs.writeFileSync(
      path.join(draftDir, 'draft.json'),
      JSON.stringify({
        articles: [
          {
            article_type: 'news',
            title: 'Symlink Draft',
            thumb_media_id: 'local://symlink.png',
            content: '<p>Hello</p>',
          },
        ],
      })
    );

    await expect(exportCommand(draftDir, { strict: true })).rejects.toThrow(
      /Local placeholder targets file outside directory/
    );
  });

  it('throws an error when local body image has unsupported format', async () => {
    const draftDir = path.join(tmpDir, 'bad-format-draft');
    fs.mkdirSync(draftDir);

    fs.writeFileSync(path.join(draftDir, 'image.xyz'), 'xyz-data');
    fs.writeFileSync(
      path.join(draftDir, 'draft.json'),
      JSON.stringify({
        articles: [
          {
            article_type: 'news',
            title: 'Bad Format Draft',
            thumb_media_id: 'local://image.xyz',
            content: '<p><img src="local://image.xyz"></p>',
          },
        ],
      })
    );

    await expect(exportCommand(draftDir, { strict: false })).rejects.toThrow(
      /Unsupported image format "\.xyz"/
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

it('inlines relative Markdown images and rejects corrupt images before writing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-export-'));
  try {
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(path.join(dir, 'image.png'));
    fs.writeFileSync(path.join(dir, 'post.md'), '![real](image.png)');
    await exportCommand(path.join(dir, 'post.md'), { output: path.join(dir, 'out.html') });
    expect(fs.readFileSync(path.join(dir, 'out.html'), 'utf8')).toContain('data:image/png;base64,');
    fs.writeFileSync(path.join(dir, 'image.png'), 'fake png');
    await expect(exportCommand(path.join(dir, 'post.md'), { output: path.join(dir, 'bad.html') })).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'bad.html'))).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
