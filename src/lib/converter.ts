export function isWeChatInternalLink(href: string): boolean {
  return /^https?:\/\/mp\.weixin\.qq\.com(\/.*)?$/i.test(href.trim());
}

export function decodeHtmlEntities(input: string): string {
  const entities: Record<string, string> = { lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"', '#39': "'", amp: '&', AMP: '&' };
  return input.replace(/&(?:lt|LT|gt|GT|quot|QUOT|#39|amp|AMP);/g, entity => entities[entity.slice(1, -1)]);
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function neuterLinksToSpans(html: string): string {
  // WeChat article content allows internal WeChat article links (mp.weixin.qq.com),
  // while external links are not clickable and converted to styled spans.
  return html.replace(/<a\s+[^>]*href=(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (match, _quote, href, text) => {
    if (isWeChatInternalLink(href)) {
      return match;
    }
    return `<span style="color: #576b95; text-decoration: underline;">${text}</span>`;
  });
}

export interface FootnoteItem {
  index: number;
  text: string;
  href: string;
}

export interface NormalizeLinksOptions {
  appendSection?: boolean;
  sectionTitle?: string;
}

export function normalizeLinksAndFootnotes(
  html: string,
  options: NormalizeLinksOptions = {}
): { html: string; footnotes: FootnoteItem[] } {
  const appendSection = options.appendSection ?? true;
  const sectionTitle = options.sectionTitle || '参考链接';

  const footnotes: FootnoteItem[] = [];
  const linkIndexMap = new Map<string, number>();

  const transformedHtml = html.replace(
    /<a\s+[^>]*href=(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (match, _quote, href, text) => {
      if (isWeChatInternalLink(href)) {
        return match;
      }

      const trimmedHref = decodeHtmlEntities(href.trim());
      let index = linkIndexMap.get(trimmedHref);
      if (!index) {
        index = footnotes.length + 1;
        linkIndexMap.set(trimmedHref, index);
        const rawText = text.replace(/<[^>]+>/g, '').trim();
        const decodedText = decodeHtmlEntities(rawText) || trimmedHref;
        footnotes.push({
          index,
          text: decodedText,
          href: trimmedHref,
        });
      }

      return `<span style="color: #576b95; text-decoration: underline;">${text}</span><sup style="font-size: 10px; color: #576b95;">[${index}]</sup>`;
    }
  );

  if (!appendSection || footnotes.length === 0) {
    return { html: transformedHtml, footnotes };
  }

  const listItems = footnotes
    .map(
      fn =>
        `<p style="margin: 4px 0; font-size: 13px; color: #666; word-break: break-all;"><span style="color: #576b95; font-weight: bold;">[${fn.index}]</span> ${escapeHtml(fn.text)}: <span style="color: #888;">${escapeHtml(fn.href)}</span></p>`
    )
    .join('\n');

  const sectionHtml = `\n<section style="margin-top: 32px; padding-top: 16px; border-top: 1px dashed #e0e0e0;">
  <h3 style="font-size: 15px; font-weight: bold; color: #333; margin-bottom: 8px;">${escapeHtml(sectionTitle)}</h3>
  ${listItems}
</section>`;

  return {
    html: `${transformedHtml}\n${sectionHtml}`,
    footnotes,
  };
}
