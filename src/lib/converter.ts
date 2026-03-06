import juice from 'juice';
import { markdownTheme } from './themes/markdown';

export function inlineCss(html: string): string {
  // Wrap content in a container to match our CSS selector
  const wrappedHtml = `<div class="markdown-body">${html}</div>`;

  // Inline the CSS
  const inlined = juice.inlineContent(wrappedHtml, markdownTheme, {
    inlinePseudoElements: true,
    preserveImportant: true,
  });

  // Clean up for WeChat: Remove IDs and classes but KEEP the style attribute
  return inlined
    .replace(/\s+id="[^"]*"/g, '')
    .replace(/\s+class="[^"]*"/g, '')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (match, href, text) => {
      // WeChat doesn't allow external links anyway.
      // We convert them to a span that looks like a link (blue + underline)
      // but only keep the inner text to avoid rendering HTML attributes as text.
      return `<span style="color: #576b95; text-decoration: underline;">${text}</span>`;
    });
}
