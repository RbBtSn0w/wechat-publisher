import { expect, test } from 'vitest';
import { escapeHtml, neuterLinksToSpans, normalizeLinksAndFootnotes } from '../src/lib/converter';

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

test('neuterLinksToSpans preserves mp.weixin.qq.com anchor links and existing attributes', () => {
  const html = '<p>Read <a href="https://mp.weixin.qq.com/s/abcdef123456" target="_blank" data-item="x">related article</a> for details.</p>';
  const result = neuterLinksToSpans(html);

  expect(result).toBe(html);
});

test('normalizeLinksAndFootnotes generates footnotes and appends references section by default', () => {
  const html = '<p>Visit <a href="https://example.com/a">Site A</a> and <a href="https://example.com/b">Site B</a>.</p>';
  const result = normalizeLinksAndFootnotes(html);

  expect(result.footnotes).toHaveLength(2);
  expect(result.footnotes[0]).toEqual({ index: 1, text: 'Site A', href: 'https://example.com/a' });
  expect(result.footnotes[1]).toEqual({ index: 2, text: 'Site B', href: 'https://example.com/b' });

  expect(result.html).toContain('Site A</span><sup style="font-size: 10px; color: #576b95;">[1]</sup>');
  expect(result.html).toContain('Site B</span><sup style="font-size: 10px; color: #576b95;">[2]</sup>');
  expect(result.html).toContain('<h3');
  expect(result.html).toContain('参考链接');
  expect(result.html).toContain('[1]</span> Site A: <span style="color: #888;">https://example.com/a</span>');
  expect(result.html).toContain('[2]</span> Site B: <span style="color: #888;">https://example.com/b</span>');
});

test('normalizeLinksAndFootnotes escapes HTML characters in footnote URLs and titles', () => {
  const html = '<p>Check <a href="https://example.com/search?a=1&b=2">A & B <test></a></p>';
  const result = normalizeLinksAndFootnotes(html, { sectionTitle: 'References & <Links>' });

  expect(result.html).toContain('References &amp; &lt;Links&gt;');
  expect(result.html).toContain('https://example.com/search?a=1&amp;b=2');
  expect(escapeHtml('<script>"alert"</script>')).toBe('&lt;script&gt;&quot;alert&quot;&lt;/script&gt;');
});

test('normalizeLinksAndFootnotes decodes pre-encoded HTML entities in links and titles before re-escaping', () => {
  const html = '<p>Visit <a href="https://example.com/search?a=1&amp;b=2">A &amp; B</a></p>';
  const result = normalizeLinksAndFootnotes(html);

  expect(result.footnotes[0].href).toBe('https://example.com/search?a=1&b=2');
  expect(result.footnotes[0].text).toBe('A & B');
  // Must not double escape &amp; to &amp;amp;
  expect(result.html).toContain('https://example.com/search?a=1&amp;b=2');
  expect(result.html).not.toContain('&amp;amp;');
  expect(result.html).toContain('A &amp; B');
});

test('normalizeLinksAndFootnotes dedupes repeated URLs', () => {
  const html = '<p>First <a href="https://example.com/a">link 1</a>, then <a href="https://example.com/a">link 2</a>.</p>';
  const result = normalizeLinksAndFootnotes(html);

  expect(result.footnotes).toHaveLength(1);
  expect(result.html).toContain('link 1</span><sup style="font-size: 10px; color: #576b95;">[1]</sup>');
  expect(result.html).toContain('link 2</span><sup style="font-size: 10px; color: #576b95;">[1]</sup>');
});

test('normalizeLinksAndFootnotes preserves WeChat internal links without footnotes', () => {
  const html = '<p><a href="https://mp.weixin.qq.com/s/123">WeChat Post</a></p>';
  const result = normalizeLinksAndFootnotes(html);

  expect(result.footnotes).toHaveLength(0);
  expect(result.html).toBe(html);
  expect(result.html).not.toContain('参考链接');
});

test('normalizeLinksAndFootnotes honors appendSection = false', () => {
  const html = '<p><a href="https://example.com">Example</a></p>';
  const result = normalizeLinksAndFootnotes(html, { appendSection: false });

  expect(result.footnotes).toHaveLength(1);
  expect(result.html).toContain('[1]</sup>');
  expect(result.html).not.toContain('参考链接');
});
