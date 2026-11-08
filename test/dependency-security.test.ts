import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { FormulaRenderer, renderMarkdownToWechat, sanitizeWechatHtml } from '@rbbtsn0w/wechat-markdown';

test('Markdown sanitizer does not expose images hidden inside a discarded raw-text element', () => {
  const html = sanitizeWechatHtml('<div><xmp></div><img src="https://untrusted.example/beacon.png"></xmp>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('untrusted.example');
});

// Exercise the sanitizer resolved by the Markdown SDK, without introducing an app dependency.
const sdkRequire = createRequire(require.resolve('@rbbtsn0w/wechat-markdown'));
const sanitizeHtml = sdkRequire('sanitize-html') as (html: string, options: Record<string, unknown>) => string;

test('sanitizer keeps configured non-text content discarded across an implied ancestor close', () => {
  const html = sanitizeHtml('<section><noscript></section><img src="https://untrusted.example/beacon.png"></noscript>', {
    allowedTags: ['section', 'img'],
    allowedAttributes: { img: ['src'] },
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  });
  expect(html).not.toContain('<img');
  expect(html).not.toContain('untrusted.example');
});

test('Markdown v1 still renders a fresh formula PNG and sanitizes article images after dependency patches', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-dependency-formula-'));
  try {
    const result = await renderMarkdownToWechat(
      '# Compatibility\n\n**Safe** $\\frac{13}{29}+\\sqrt{37}$\n\n<img src="https://example.com/article.png" onerror="unsafe()">\n\n<script>unsafe()</script>',
      { renderMermaid: false, services: { formulaRenderer: new FormulaRenderer(directory) } },
    );
    expect(result.stats.formulas).toBe(1);
    expect(result.html).toContain('<strong');
    expect(result.html).toContain('https://example.com/article.png');
    expect(result.html).not.toMatch(/<script|onerror|unsafe\(\)/);
    const generated = result.images.find(image => image.startsWith(directory));
    expect(generated).toBeDefined();
    const image = await sharp(generated).metadata();
    expect(image.format).toBe('png');
    expect(image.width).toBeGreaterThan(0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
