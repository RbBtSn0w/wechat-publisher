import { expect, test } from 'vitest';
import { neuterLinksToSpans } from '../src/lib/converter';

test('neuterLinksToSpans converts anchor tags into styled, non-interactive spans', () => {
  const html = '<p>See <a href="https://example.com/docs">the docs</a> for more.</p>';
  const result = neuterLinksToSpans(html);

  expect(result).not.toContain('<a ');
  expect(result).toContain('<span style="color: #576b95; text-decoration: underline;">the docs</span>');
});

test('neuterLinksToSpans leaves plain text untouched', () => {
  const html = '<p>No links here.</p>';
  expect(neuterLinksToSpans(html)).toBe(html);
});

test('neuterLinksToSpans preserves mp.weixin.qq.com anchor links', () => {
  const html = '<p>Read <a href="https://mp.weixin.qq.com/s/abcdef123456">related article</a> for details.</p>';
  const result = neuterLinksToSpans(html);

  expect(result).toContain('<a href="https://mp.weixin.qq.com/s/abcdef123456"');
  expect(result).toContain('related article</a>');
});

