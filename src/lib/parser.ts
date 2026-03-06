import { marked } from 'marked';
import yaml from 'yaml';
import fs from 'fs';
import { BlogPost } from '../types';

export function parseMarkdown(filePath: string): Partial<BlogPost> {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  
  // Extract Front-matter
  const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = fileContent.match(frontMatterRegex);
  
  let metadata: any = {};
  let contentMarkdown = fileContent;
  
  if (match) {
    try {
      metadata = yaml.parse(match[1]);
      contentMarkdown = fileContent.replace(match[0], '').trim();
    } catch (e) {
      console.warn('Failed to parse front-matter:', e);
    }
  }

  let title = metadata.title || 'Untitled';
  const author = metadata.author || '';
  let digest = metadata.description || contentMarkdown.substring(0, 64).replace(/\n/g, ' ') + '...';
  
  if (title.length > 64) {
    title = title.substring(0, 61) + '...';
  }

  if (digest.length > 64) {
    digest = digest.substring(0, 61) + '...';
  }

  let localThumbPath = metadata.cover || metadata.image?.path || '';

  return {
    title,
    author,
    digest,
    contentMarkdown,
    localThumbPath,
    originalPath: filePath,
  };
}

export function convertMarkdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

export function extractImagePaths(markdown: string): string[] {
  // Matches ![alt](path) and <img src="path">
  const mdRegex = /!\[.*?\]\((.*?)\)/g;
  const htmlRegex = /<img\s+[^>]*src=["'](.*?)["']/g;
  const paths = new Set<string>();
  
  let match;
  while ((match = mdRegex.exec(markdown)) !== null) {
    paths.add(match[1].trim());
  }
  while ((match = htmlRegex.exec(markdown)) !== null) {
    paths.add(match[1].trim());
  }
  return Array.from(paths);
}

export function replaceImagePaths(markdown: string, replacements: Record<string, string>): string {
  let result = markdown;
  for (const [oldPath, newPath] of Object.entries(replacements)) {
    // Escape special characters for regex
    const escapedPath = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\]\\s*\\(\\s*${escapedPath}\\s*\\)`, 'g');
    result = result.replace(regex, `](${newPath})`);
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
  const regex = /```mermaid\n([\s\S]*?)\n```/g;
  const blocks: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

export function replaceMermaidBlocks(markdown: string, replacements: Record<string, string>): string {
  let result = markdown;
  for (const [code, imgTag] of Object.entries(replacements)) {
    result = result.split(`\`\`\`mermaid\n${code}\n\`\`\``).join(imgTag);
  }
  return result;
}
