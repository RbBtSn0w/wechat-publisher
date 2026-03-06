import juice from 'juice';
import { getTheme } from './themes';

export function inlineCss(html: string, siteUrl?: string, style: string = 'tech'): string {
  // 1. First, resolve relative links if siteUrl is provided
  let processedHtml = html;
  if (siteUrl) {
    processedHtml = html.replace(/(<a\s+[^>]*href=")(\/[^"]*)(")/g, (match, p1, p2, p3) => {
      return `${p1}${siteUrl}${p2}${p3}`;
    });
  }

  // 2. Wrap content in a container to match our CSS selector
  const wrappedHtml = `<div class="markdown-body">${processedHtml}</div>`;

  // 3. Inline the CSS
  const theme = getTheme(style);
  const inlined = juice.inlineContent(wrappedHtml, theme, {
    inlinePseudoElements: true,
    preserveImportant: true,
  });

  // 4. Clean up for WeChat: Remove IDs and classes but KEEP the style attribute
  let finalHtml = inlined
    .replace(/\s+id="[^"]*"/g, '')
    .replace(/\s+class="[^"]*"/g, '')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (match, href, text) => {
      // WeChat doesn't allow external links anyway.
      // We convert them to a span that looks like a link (blue + underline)
      return `<span style="color: #576b95; text-decoration: underline;">${text}</span>`;
    })
    .replace(/\n\s*\n/g, '\n') // Collapse multiple newlines
    .trim();

  // Strip newlines around list items to prevent WeChat editor from inserting empty bullets
  finalHtml = finalHtml
    .replace(/<ul([^>]*)>\s+/g, '<ul$1>')
    .replace(/<ol([^>]*)>\s+/g, '<ol$1>')
    .replace(/<\/li>\s+/g, '</li>')
    .replace(/\s+<\/ul>/g, '</ul>')
    .replace(/\s+<\/ol>/g, '</ol>');

  return finalHtml;
}

