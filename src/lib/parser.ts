import yaml from 'yaml';
import { maskProtectedRegions, findFencedCodeRegions, replaceSourceRegions, SourceScanOptions } from './source-regions';
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

export function normalizeJekyllMarkdown(markdown: string): string {
  // Chirpy/Jekyll attribute lists are presentation hints that marked does not
  // understand. Remove them while preserving the Markdown link itself.
  const visible = maskProtectedRegions(markdown);
  const edits = [...visible.matchAll(/(\]\([^\n]*?\))\{:[^}\n]+\}/g)].map(match => ({ start: match.index! + match[1].length, end: match.index! + match[0].length, replacement: '' }));
  return replaceSourceRegions(markdown, edits);
}

export function findUnsupportedMarkdown(markdown: string, sourcePath?: string): ConversionDiagnostic[] {
  const diagnostics: ConversionDiagnostic[] = [];
  const lines = maskProtectedRegions(markdown).split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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

interface MathOccurrence extends MathExpression { start: number; end: number }

function findMathOccurrences(markdown: string): MathOccurrence[] {
  const visible = maskProtectedRegions(markdown);
  const pattern = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g;
  const result: MathOccurrence[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(visible))) {
    const display = match[1] !== undefined;
    const expression = (match[1] ?? match[2]).trim();
    result.push({ key: mathKey(expression, display), source: markdown.slice(match.index, pattern.lastIndex), expression, display, start: match.index, end: pattern.lastIndex });
  }
  return result;
}

export function extractMathExpressions(markdown: string): MathExpression[] {
  return findMathOccurrences(markdown).map(({ key, source, expression, display }) => ({ key, source, expression, display }));
}

export function replaceMathExpressions(markdown: string, replacements: Record<string, string>): string {
  return replaceSourceRegions(markdown, findMathOccurrences(markdown).filter(item => replacements[item.key]).map(item => ({ ...item, replacement: replacements[item.key] })));
}

export interface ResourceOccurrence { path: string; start: number; end: number; bareMarkdown?: boolean }

function imageOccurrences(markdown: string, options: SourceScanOptions = {}): ResourceOccurrence[] {
  const visible = maskProtectedRegions(markdown, options);
  const occurrences: ResourceOccurrence[] = [];
  const pattern = /!\[[^\]]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)|<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(visible))) {
    let resource = match[1] ?? match[2];
    let offset: number;
    if (resource !== undefined) {
      offset = match[0].indexOf('](') + 2;
      while (/\s/.test(match[0][offset])) offset += 1;
      if (match[0][offset] === '<') offset += 1;
    } else {
      const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
      if (!src) continue;
      resource = src[1] ?? src[2] ?? src[3];
      offset = src.index + src[0].indexOf('=') + 1;
      while (/\s/.test(match[0][offset])) offset += 1;
      if (/['"]/.test(match[0][offset])) offset += 1;
    }
    const start = match.index + offset;
    occurrences.push({ path: resource, start, end: start + resource.length, bareMarkdown: match[2] !== undefined });
  }
  return occurrences;
}

/** Visible image destinations plus raw local placeholders, suitable for draft resolution. */
export function findResourceOccurrences(source: string, options: SourceScanOptions = {}): ResourceOccurrence[] {
  const images = imageOccurrences(source, options);
  const pattern = /local:\/\/[^\s'")<>]+/g;
  const visible = maskProtectedRegions(source, options);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(visible))) {
    if (!images.some(item => match!.index >= item.start && match!.index < item.end)) {
      images.push({ path: match[0], start: match.index, end: pattern.lastIndex });
    }
  }
  return images.sort((a, b) => a.start - b.start);
}

export function extractImagePaths(markdown: string, options: SourceScanOptions = {}): string[] {
  return [...new Set(imageOccurrences(markdown, options).map(item => item.path))];
}

export function replaceImagePaths(markdown: string, replacements: Record<string, string>, options: SourceScanOptions = {}): string {
  return replaceSourceRegions(markdown, imageOccurrences(markdown, options)
    .filter(item => Object.prototype.hasOwnProperty.call(replacements, item.path))
    .map(item => {
      const value = replacements[item.path];
      return { ...item, replacement: item.bareMarkdown && /[\s()]/.test(value) ? `<${value}>` : value };
    }));
}

export function resolveRelativeLinks(html: string, baseUrl: string): string {
  // Convert relative links like <a href="/posts/..."> to absolute
  return html.replace(/(<a\s+[^>]*href=")(\/[^"]*)(")/g, (match, p1, p2, p3) => {
    return `${p1}${baseUrl}${p2}${p3}`;
  });
}

export function extractMermaidBlocks(markdown: string): string[] {
  return findFencedCodeRegions(markdown).filter(item => /^mermaid(?:\s|$)/i.test(item.info)).map(item => markdown.slice(item.contentStart, item.contentEnd).trim());
}

export function replaceMermaidBlocks(markdown: string, replacements: Record<string, string>): string {
  const edits = findFencedCodeRegions(markdown).filter(item => /^mermaid(?:\s|$)/i.test(item.info)).map(item => ({ ...item, replacement: replacements[markdown.slice(item.contentStart, item.contentEnd).trim()] })).filter(item => item.replacement).map(item => ({ ...item, replacement: `\n\n${item.replacement.trim()}\n\n` }));
  return replaceSourceRegions(markdown, edits);
}
