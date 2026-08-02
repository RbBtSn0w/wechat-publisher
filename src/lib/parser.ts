import { marked } from 'marked';
import yaml from 'yaml';
import fs from 'fs';
import { BlogPost, ConversionDiagnostic, WeChatArticleType } from '../types';

const SUPPORTED_ARTICLE_TYPES: ReadonlySet<WeChatArticleType> = new Set(['news', 'newspic']);

export function parseMarkdown(filePath: string): Partial<BlogPost> {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  
  // Extract the YAML front matter accepted by common Jekyll/Markdown writers.
  const frontMatterRegex = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
  const match = fileContent.match(frontMatterRegex);
  
  let metadata: any = {};
  let contentMarkdown = fileContent;
  
  if (match) {
    try {
      metadata = yaml.parse(match[1]);
      contentMarkdown = fileContent.slice(match[0].length).trim();
    } catch (e) {
      throw new Error(`Failed to parse front-matter in ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const title = String(metadata.title ?? 'Untitled');
  const author = String(metadata.author ?? '');
  const digest = String(metadata.description ?? contentMarkdown.substring(0, 64).replace(/\n/g, ' ') + '...');

  const localThumbPath = metadata.cover || metadata.image?.path || '';
  const rawArticleType = metadata.article_type ?? metadata.articleType ?? 'news';
  const articleType = String(rawArticleType).trim().toLowerCase() as WeChatArticleType;

  if (!SUPPORTED_ARTICLE_TYPES.has(articleType)) {
    throw new Error(`Invalid article_type: "${rawArticleType}". Supported values: news, newspic.`);
  }

  return {
    title,
    author,
    digest,
    contentMarkdown,
    localThumbPath,
    articleType,
    originalPath: filePath,
  };
}

export function convertMarkdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

export function normalizeJekyllMarkdown(markdown: string): string {
  // Chirpy/Jekyll attribute lists are presentation hints that marked does not
  // understand. Remove them while preserving the Markdown link itself.
  return markdown.replace(/(\]\([^\n]*?\))\{:[^}\n]+\}/g, '$1');
}

export function findUnsupportedMarkdown(markdown: string, sourcePath?: string): ConversionDiagnostic[] {
  const diagnostics: ConversionDiagnostic[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    if (/^\s*>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(line)) {
      diagnostics.push({
        code: 'UNSUPPORTED_GFM_ALERT',
        severity: 'error',
        message: 'GFM alert blocks are not supported by the WeChat renderer.',
        sourcePath,
        line: index + 1,
      });
    }
    if (/^\s*\[\^[^\]]+\]:/.test(line) || /\[\^[^\]]+\]/.test(line)) {
      diagnostics.push({
        code: 'UNSUPPORTED_FOOTNOTE',
        severity: 'error',
        message: 'Markdown footnotes are not supported by the WeChat renderer.',
        sourcePath,
        line: index + 1,
      });
    }
  }

  return diagnostics;
}

export interface MathExpression {
  key: string;
  source: string;
  expression: string;
  display: boolean;
}

function mathKey(expression: string, display: boolean): string {
  return `${display ? 'display' : 'inline'}:${expression}`;
}

export function extractMathExpressions(markdown: string): MathExpression[] {
  const expressions: MathExpression[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;

    const displayStart = line.indexOf('$$');
    if (displayStart >= 0) {
      const displayEnd = line.indexOf('$$', displayStart + 2);
      if (displayEnd > displayStart + 2) {
        const expression = line.slice(displayStart + 2, displayEnd).trim();
        const source = line.slice(displayStart, displayEnd + 2);
        expressions.push({ key: mathKey(expression, true), source, expression, display: true });
        continue;
      }
      const collected: string[] = [];
      for (let end = index + 1; end < lines.length; end += 1) {
        if (lines[end].includes('$$')) {
          const closeIndex = lines[end].indexOf('$$');
          collected.push(lines[end].slice(0, closeIndex));
          const expression = collected.join('\n').trim();
          const source = lines.slice(index, end + 1).join('\n');
          expressions.push({ key: mathKey(expression, true), source, expression, display: true });
          index = end;
          break;
        }
        collected.push(lines[end]);
      }
      continue;
    }

    const inlineRegex = /(?<!\\)\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g;
    let match: RegExpExecArray | null;
    while ((match = inlineRegex.exec(line)) !== null) {
      const expression = match[1].trim();
      expressions.push({ key: mathKey(expression, false), source: match[0], expression, display: false });
    }
  }

  return expressions;
}

export function replaceMathExpressions(markdown: string, replacements: Record<string, string>): string {
  let result = markdown;
  for (const expression of extractMathExpressions(markdown)) {
    const replacement = replacements[expression.key];
    if (replacement) result = result.split(expression.source).join(replacement);
  }
  return result;
}

export function extractImagePaths(markdown: string): string[] {
  const paths = new Set<string>();

  // Support optional Markdown titles and angle-bracket destinations.
  const mdRegex = /!\[[^\]]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdRegex.exec(markdown)) !== null) {
    paths.add((match[1] || match[2]).trim());
  }

  // HTML attributes may appear in any order and may use single or double quotes.
  const htmlRegex = /<img\b[^>]*>/gi;
  const srcRegex = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
  while ((match = htmlRegex.exec(markdown)) !== null) {
    const srcMatch = match[0].match(srcRegex);
    if (srcMatch) paths.add((srcMatch[1] || srcMatch[2] || srcMatch[3]).trim());
  }
  return Array.from(paths);
}

export function replaceImagePaths(markdown: string, replacements: Record<string, string>): string {
  let result = markdown;
  for (const [oldPath, newPath] of Object.entries(replacements)) {
    const escapedPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const markdownRegex = new RegExp(`(!\\[[^\\]]*\\]\\(\\s*)(<)?(?:${escapedPath})(?=>|\\s|\\))`, 'g');
    const htmlRegex = new RegExp(`(<img\\b[^>]*\\bsrc\\s*=\\s*["']?)(?:${escapedPath})(?=["'\\s>])`, 'gi');
    result = result
      .replace(markdownRegex, (_match, prefix, angleBracket) => `${prefix}${angleBracket || ''}${newPath}`)
      .replace(htmlRegex, (_match, prefix) => `${prefix}${newPath}`);
  }
  return result;
}

export function resolveRelativeLinks(html: string, baseUrl: string): string {
  // Convert relative links like <a href="/posts/..."> to absolute
  return html.replace(/(<a\s+[^>]*href=")(\/[^"]*)(")/g, (match, p1, p2, p3) => {
    return `${p1}${baseUrl}${p2}${p3}`;
  });
}

export function extractMermaidBlocks(markdown: string): string[] {
  const regex = /^( {0,3})(`{3,}|~{3,})[ \t]*mermaid(?:[ \t]+[^\r\n]*)?[ \t]*\r?\n([\s\S]*?)^\1\2[ \t]*(?:\r?\n|$)/gim;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[3].trim());
  }
  return blocks;
}

export function replaceMermaidBlocks(markdown: string, replacements: Record<string, string>): string {
  const regex = /^( {0,3})(`{3,}|~{3,})[ \t]*mermaid(?:[ \t]+[^\r\n]*)?[ \t]*\r?\n([\s\S]*?)^\1\2[ \t]*(?:\r?\n|$)/gim;
  return markdown.replace(regex, (match, _indent, _fence, code) => replacements[code.trim()] || match);
}
