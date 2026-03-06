export const markdownTheme = `
  .markdown-body {
    font-size: 16px;
    line-height: 1.6;
    color: #24292e;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  .markdown-body h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
  .markdown-body h3 { font-size: 1.25em; }
  .markdown-body p { margin-top: 0; margin-bottom: 16px; }
  .markdown-body blockquote {
    padding: 0 1em;
    color: #6a737d;
    border-left: 0.25em solid #dfe2e5;
    margin: 0 0 16px 0;
  }
  .markdown-body code {
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    background-color: rgba(27,31,35,0.05);
    border-radius: 3px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  }
  .markdown-body pre {
    padding: 16px;
    overflow: auto;
    font-size: 85%;
    line-height: 1.45;
    background-color: #f6f8fa;
    border-radius: 3px;
    margin-bottom: 16px;
  }
  .markdown-body pre code {
    background-color: transparent;
    padding: 0;
    font-size: 100%;
    white-space: pre;
  }
  .markdown-body ul, .markdown-body ol {
    padding-left: 2em;
    margin-bottom: 16px;
  }
  .markdown-body li {
    margin-bottom: 0.25em;
  }
  /* 解决微信列表点丢失问题 */
  .markdown-body ul { list-style-type: disc !important; }
  .markdown-body ol { list-style-type: decimal !important; }
  
  .markdown-body img {
    max-width: 100%;
    box-sizing: content-box;
  }
  .markdown-body a {
    color: #0366d6;
    text-decoration: none;
  }
`;
