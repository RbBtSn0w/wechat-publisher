export function neuterLinksToSpans(html: string): string {
  // WeChat article content doesn't render clickable <a href> anyway, so links
  // are converted to a span that looks like one (blue + underline).
  return html.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (match, href, text) => {
    return `<span style="color: #576b95; text-decoration: underline;">${text}</span>`;
  });
}
