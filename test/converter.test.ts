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

test('inlineCss removes unsafe raw HTML and keeps table structure', () => {
  const html = '<script>alert(1)</script><table><tr><th>A</th></tr></table>';
  const styledHtml = inlineCss(html);
  expect(styledHtml).not.toContain('<script>');
  expect(styledHtml).toContain('<table');
  expect(styledHtml).toContain('border-collapse');
});

test('inlineCss preserves sanitization when resolving site URLs', () => {
  const styledHtml = inlineCss(
    '<script>alert(1)</script><p onclick="alert(2)">Safe</p><a href="/docs">Docs</a>',
    'https://example.com',
  );

  expect(styledHtml).not.toContain('<script');
  expect(styledHtml).not.toContain('onclick');
  expect(styledHtml).toContain('Safe');
  expect(styledHtml).toContain('Docs');
});
