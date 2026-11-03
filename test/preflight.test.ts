import { describe, it, expect } from 'vitest';
import { validateCoverImage, validatePlaceholderText, runPreflightCheck } from '../src/lib/preflight';
import path from 'path';
import fs from 'fs';
import os from 'os';
import sharp from 'sharp';

describe('validatePlaceholderText', () => {
  it('does not match inline code across separate Markdown blocks', () => {
    for (const content of ['` unmatched opener\n\n[TODO: finish]\n\nclosing `', '` unmatched\n# [TODO: heading]\nclosing `']) {
      expect(validatePlaceholderText(content)).toHaveLength(1);
    }
  });
  it('detects unresolved TODO and placeholder patterns with line numbers', () => {
    const content = `Line 1: Hello
Line 2: [TODO: Add diagram]
Line 3: Normal text
Line 4: 【待补充】详细说明
Line 5: local://missing.png
Line 6: FIXME: check this`;

    const issues = validatePlaceholderText(content);
    expect(issues).toHaveLength(4);
    expect(issues[0]).toMatchObject({ line: 2, severity: 'error' });
    expect(issues[1]).toMatchObject({ line: 4, severity: 'error' });
    expect(issues[2]).toMatchObject({ line: 5, severity: 'error' });
    expect(issues[3]).toMatchObject({ line: 6, severity: 'warning' });
  });

  it('ignores placeholders inside fenced code blocks, inline code, and <pre>/<code> tags', () => {
    const content = `# Technical Guide

Use \`[TODO: inline]\` or \`local://image.png\` syntax in your config.

\`\`\`typescript
// [TODO: implement handler]
const img = "local://avatar.png";
// FIXME: refactor later
\`\`\`

<pre><code>[TODO: inside pre] local://pre.png</code></pre>

Normal prose paragraph.`;

    expect(validatePlaceholderText(content)).toHaveLength(0);
  });

  it('returns no issues on clean content', () => {
    const content = `# Title\n\nClean article content without any placeholders.`;
    expect(validatePlaceholderText(content)).toHaveLength(0);
  });
});

describe('validateCoverImage', () => {
  it('passes on an image that matches 2.35:1 aspect ratio', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
    const imgPath = path.join(tmpDir, 'cover-235.png');
    // 940 x 400 is exactly 2.35
    await sharp({
      create: {
        width: 940,
        height: 400,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toFile(imgPath);

    const issues = await validateCoverImage(imgPath);
    expect(issues).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flags warning/error on square aspect ratio', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
    const imgPath = path.join(tmpDir, 'cover-square.png');
    await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toFile(imgPath);

    const issues = await validateCoverImage(imgPath);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('2.35:1');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns error if cover file does not exist', async () => {
    const issues = await validateCoverImage('/non/existent/cover.png');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('not found');
  });
});

describe('runPreflightCheck', () => {
  it('checks source link placeholders once while allowing resolved local images', async () => {
    const result = await runPreflightCheck({
      sourceMarkdown: '[TODO: missing](https://example.com)\n\n![Figure](local://image.png)',
      content: '<a href="https://example.com">TODO: missing</a><img src="data:image/png;base64,AA==">',
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'error', line: 1 })]);
  });

  it('still rejects unresolved local placeholders in final HTML when source Markdown is supplied', async () => {
    const result = await runPreflightCheck({
      sourceMarkdown: 'Clean source',
      content: '<p>local://missing.png</p>',
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'error', line: 1 })]);
  });

  it('combines text and image validation and evaluates passed status', async () => {
    const result = await runPreflightCheck({
      content: 'Clean text',
    });
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails if there are errors present', async () => {
    const result = await runPreflightCheck({
      content: 'Line 1\n[TODO: Need cover image]',
      strict: true,
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.severity === 'error')).toBe(true);
  });
});

it('preserves prose on HTML closing lines and requires whitespace-only fence closure', () => {
  const source = ['````md', '````not-close', '[TODO: example]', '````', '<code>', '[TODO: example]', '</code> [TODO: real]', '``[TODO: example] ` x``'].join('\n');
  expect(validatePlaceholderText(source)).toEqual([expect.objectContaining({ line: 7, severity: 'error' })]);
});

it('detects rendered placeholders once and decodes entities only after masking code', async () => {
  const result = await runPreflightCheck({
    sourceMarkdown: '[TODO] prose and `&#91;TODO&#93;`',
    content: '<p>[TODO] prose and <code>&#91;TODO&#93;</code></p>',
  });
  expect(result.issues).toHaveLength(1);
  const encoded = await runPreflightCheck({ sourceMarkdown: '&#91;TODO&#93;', content: '<p>&#91;TODO&#93;</p>' });
  expect(encoded.passed).toBe(false);
  expect(encoded.issues).toHaveLength(1);
});

it('does not hide final local placeholders after a comment-like quoted attribute', async () => {
  const result = await runPreflightCheck({ content: '<p data-example="<!--">Example</p><img src="local://body.png">' });
  expect(result.passed).toBe(false);
  expect(result.issues).toHaveLength(1);
});

it('does not recursively decode visible entities or treat escaped code tags as protected HTML', async () => {
  expect((await runPreflightCheck({ sourceMarkdown: 'literal', content: '<p>&amp;#91;TODO&amp;#93;</p>' })).passed).toBe(true);
  expect((await runPreflightCheck({ sourceMarkdown: 'literal', content: '<p>&lt;code&gt;&#91;TODO&#93;&lt;/code&gt;</p>' })).passed).toBe(false);
  expect((await runPreflightCheck({ sourceMarkdown: 'literal', content: '<code>&#91;TODO&#93;</code>' })).passed).toBe(true);
});
