export function isWeChatInternalLink(href: string): boolean {
  return /^https?:\/\/mp\.weixin\.qq\.com(\/.*)?$/i.test(href.trim());
}

export function neuterLinksToSpans(html: string): string {
  // WeChat article content allows internal WeChat article links (mp.weixin.qq.com),
  // while external links are not clickable and converted to styled spans.
  return html.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, href, text) => {
    if (isWeChatInternalLink(href)) {
      return `<a href="${href.trim()}" style="color: #576b95; text-decoration: underline;">${text}</a>`;
    }
    return `<span style="color: #576b95; text-decoration: underline;">${text}</span>`;
  });
}

