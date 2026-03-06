import juice from 'juice';

export function inlineCss(html: string, extraCss: string = ''): string {
  const defaultWechatCss = `
    body { font-size: 16px; color: #333; line-height: 1.6; }
    h1, h2, h3, h4, h5, h6 { color: #222; font-weight: bold; margin-bottom: 16px; }
    p { margin-bottom: 16px; }
    img { max-width: 100%; height: auto; display: block; margin: 10px auto; }
    pre { background-color: #f6f8fa; padding: 16px; overflow: auto; border-radius: 6px; }
    code { font-family: monospace; font-size: 14px; }
    blockquote { border-left: 4px solid #dfe2e5; padding-left: 16px; color: #6a737d; }
    a { color: #0366d6; text-decoration: none; }
  `;

  const inlined = juice.inlineContent(html, defaultWechatCss + extraCss, {
    inlinePseudoElements: true,
    preserveImportant: true,
  });

  // Strip id and class attributes which often cause "invalid content" in WeChat API
  return inlined
    .replace(/\s+id=".*?"/g, '')
    .replace(/\s+class=".*?"/g, '');
}
