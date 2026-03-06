import { expect, test } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseMarkdown, extractImagePaths, replaceImagePaths } from '../src/lib/parser';

test('parseMarkdown extracts front-matter', () => {
  const p = path.join(__dirname, 'temp.md');
  fs.writeFileSync(p, `---\ntitle: T\nauthor: A\ndescription: D\ncover: C\n---\nBody`);
  const r = parseMarkdown(p);
  expect(r.title).toBe('T');
  expect(r.author).toBe('A');
  expect(r.digest).toBe('D');
  expect(r.localThumbPath).toBe('C');
  expect(r.contentMarkdown).toBe('Body');
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
