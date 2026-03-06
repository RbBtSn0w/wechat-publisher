import { expect, test } from 'vitest';
import { inlineCss } from '../src/lib/converter';
import { convertMarkdownToHtml } from '../src/lib/parser';

test('convertMarkdownToHtml handles markdown', () => {
  const md = '# Hello\nThis is a **test**.';
  const html = convertMarkdownToHtml(md);
  expect(html).toContain('<h1>Hello</h1>');
  expect(html).toContain('<strong>test</strong>');
});

test('inlineCss applies styles', () => {
  const html = '<h1>Title</h1>';
  const styledHtml = inlineCss(html);
  expect(styledHtml).toContain('style="');
});
