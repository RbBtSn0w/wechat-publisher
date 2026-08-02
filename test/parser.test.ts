import { expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseMarkdown,
  extractImagePaths,
  replaceImagePaths,
  extractMermaidBlocks,
  replaceMermaidBlocks,
  normalizeJekyllMarkdown,
  findUnsupportedMarkdown,
  extractMathExpressions,
  replaceMathExpressions,
} from '../src/lib/parser';

test('parseMarkdown extracts front-matter', () => {
  const p = path.join(__dirname, 'temp.md');
  fs.writeFileSync(p, `---\ntitle: T\nauthor: A\ndescription: D\ncover: C\narticle_type: newspic\n---\nBody`);
  const r = parseMarkdown(p);
  expect(r.title).toBe('T');
  expect(r.author).toBe('A');
  expect(r.digest).toBe('D');
  expect(r.localThumbPath).toBe('C');
  expect(r.articleType).toBe('newspic');
  expect(r.contentMarkdown).toBe('Body');
  fs.unlinkSync(p);
});

test('parseMarkdown defaults article_type to news', () => {
  const p = path.join(__dirname, 'temp-default-type.md');
  fs.writeFileSync(p, `---\ntitle: T\n---\nBody`);
  const r = parseMarkdown(p);
  expect(r.articleType).toBe('news');
  fs.unlinkSync(p);
});

test('parseMarkdown rejects invalid article_type', () => {
  const p = path.join(__dirname, 'temp-invalid-type.md');
  fs.writeFileSync(p, `---\ntitle: T\narticle_type: video\n---\nBody`);
  expect(() => parseMarkdown(p)).toThrow(/Invalid article_type/);
  fs.unlinkSync(p);
});

test('extractImagePaths finds all markdown images', () => {
  const md = `
    ![alt](/assets/img1.png)
    Some text
    ![alt2](https://example.com/img2.jpg)
  `;
  const paths = extractImagePaths(md);
  expect(paths).toContain('/assets/img1.png');
  expect(paths).toContain('https://example.com/img2.jpg');
});

test('replaceImagePaths replaces exactly', () => {
  const md = `![alt](/assets/img1.png)`;
  const result = replaceImagePaths(md, { '/assets/img1.png': 'http://wechat/img1' });
  expect(result).toContain('![alt](http://wechat/img1)');
});

test('parseMarkdown accepts CRLF front-matter and image.path', () => {
  const p = path.join(__dirname, 'temp-crlf.md');
  fs.writeFileSync(p, `---\r\ntitle: T\r\nimage:\r\n  path: /cover.png\r\n---\r\nBody`);
  const r = parseMarkdown(p);
  expect(r.title).toBe('T');
  expect(r.localThumbPath).toBe('/cover.png');
  expect(r.contentMarkdown).toBe('Body');
  fs.unlinkSync(p);
});

test('extracts and replaces Mermaid blocks with common fence variants', () => {
  const md = [
    '  ``` mermaid',
    'flowchart TD',
    '  A --> B',
    '  ```',
    '',
    '~~~mermaid',
    'sequenceDiagram',
    '  A->>B: hello',
    '~~~',
  ].join('\n');

  const blocks = extractMermaidBlocks(md);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]).toContain('flowchart TD');
  expect(blocks[1]).toContain('sequenceDiagram');

  const result = replaceMermaidBlocks(md, {
    [blocks[0]]: '![diagram](one.png)',
    [blocks[1]]: '![diagram](two.png)',
  });
  expect(result).toContain('![diagram](one.png)');
  expect(result).toContain('![diagram](two.png)');
  expect(result).not.toContain('```');
  expect(result).not.toContain('~~~');
});

test('extracts image paths with titles, angle brackets, and reordered HTML attributes', () => {
  const md = [
    '![alt](/assets/cover.png "Cover")',
    '![alt](</assets/a file.png> \'A file\')',
    '<img alt="cover" data-x="1" src="/assets/html.png" loading="lazy">',
  ].join('\n');
  expect(extractImagePaths(md)).toEqual([
    '/assets/cover.png',
    '/assets/a file.png',
    '/assets/html.png',
  ]);
});

test('extractImagePaths ignores images inside fenced code blocks', () => {
  const md = [
    '![real](/assets/real.png)',
    '',
    '```markdown',
    '![example](/assets/example.png)',
    '<img src="/assets/example.html.png">',
    '```',
  ].join('\n');

  expect(extractImagePaths(md)).toEqual(['/assets/real.png']);
});

test('replaceImagePaths preserves Markdown image titles and handles HTML images', () => {
  const md = [
    '![alt](/assets/cover.png "Cover")',
    '![alt](</assets/a file.png>)',
    '<img alt="cover" src="/assets/html.png">',
  ].join('\n');
  const result = replaceImagePaths(md, {
    '/assets/cover.png': 'http://wechat/cover',
    '/assets/a file.png': 'http://wechat/file',
    '/assets/html.png': 'http://wechat/html',
  });
  expect(result).toContain('![alt](http://wechat/cover "Cover")');
  expect(result).toContain('![alt](<http://wechat/file>)');
  expect(result).toContain('src="http://wechat/html"');
});

test('normalizeJekyllMarkdown removes presentation attributes from links', () => {
  expect(normalizeJekyllMarkdown('[link](/docs){:target="_blank" rel="noopener"}'))
    .toBe('[link](/docs)');
});

test('findUnsupportedMarkdown reports footnotes and GFM alerts but ignores code examples', () => {
  const diagnostics = findUnsupportedMarkdown([
    '> [!WARNING]',
    'Use [^note].',
    '',
    '```markdown',
    '> [!TIP]',
    '[^note]: Example',
    '```',
  ].join('\n'), 'post.md');

  expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
    'UNSUPPORTED_GFM_ALERT',
    'UNSUPPORTED_FOOTNOTE',
  ]);
  expect(diagnostics[0].sourcePath).toBe('post.md');
  expect(diagnostics[0].line).toBe(1);
});

test('extracts and replaces inline and display math without touching code', () => {
  const md = [
    'Inline $E=mc^2$ here.',
    '',
    '$$',
    'a^2+b^2=c^2',
    '$$',
    '',
    '```text',
    '$not math$',
    '```',
  ].join('\n');
  const expressions = extractMathExpressions(md);
  expect(expressions.map(expression => expression.expression)).toEqual(['E=mc^2', 'a^2+b^2=c^2']);
  const result = replaceMathExpressions(md, Object.fromEntries(
    expressions.map(expression => [expression.key, `[math:${expression.display}]`])
  ));
  expect(result).toContain('[math:false]');
  expect(result).toContain('[math:true]');
  expect(result).toContain('$not math$');
});
