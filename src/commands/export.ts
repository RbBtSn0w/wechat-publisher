import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { maskProtectedRegions, replaceSourceRegions } from '../lib/source-regions';
import { normalizeJekyllMarkdown, parseMarkdown, extractImagePaths, replaceImagePaths } from '../lib/parser';
import { readPortableImage, resolveContainedFile } from '../lib/media';
import { renderMarkdownToWechat } from '@rbbtsn0w/wechat-markdown';
import { LEGACY_THEME_NAME } from '../lib/theme-registry';
import { decodeHtmlEntities, normalizeLinksAndFootnotes } from '../lib/converter';
import { copyRichTextToClipboard } from '../lib/clipboard';
import { runPreflightCheck } from '../lib/preflight';
import {
  parseLocalPlaceholder,
  readDraftPayloadFromDirectory,
  resolveLocalFile,
} from '../lib/directory-draft';

export interface ExportCommandOptions {
  clip?: boolean;
  output?: string;
  theme?: string;
  strict?: boolean;
  footnotes?: boolean;
}

export async function exportCommand(targetPath: string, options: ExportCommandOptions = {}): Promise<void> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File or directory not found: ${fullPath}`);
  }

  let isPreRenderedHtml = false;
  let sourceContent = '';
  let coverPath: string | undefined;
  let mediaBaseDir = path.dirname(fullPath);

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    mediaBaseDir = fullPath;
    // Draft directory mode: check if a single JSON draft payload exists
    const jsonFiles = fs
      .readdirSync(fullPath)
      .filter(file => file.toLowerCase().endsWith('.json'));

    if (jsonFiles.length === 1) {
      const draftData = readDraftPayloadFromDirectory(fullPath);
      const firstArticle = draftData.articles[0] || {};
      sourceContent = typeof firstArticle.content === 'string' ? firstArticle.content : '';
      isPreRenderedHtml = true;

      const rawThumb = typeof firstArticle.thumb_media_id === 'string' ? firstArticle.thumb_media_id : '';
      if (parseLocalPlaceholder(rawThumb)) {
        coverPath = resolveLocalFile(fullPath, rawThumb);
      }

    } else {
      const mdCandidates = ['index.md', 'README.md', 'post.md'];
      const found = mdCandidates.find(f => fs.existsSync(path.join(fullPath, f)));
      if (!found) {
        throw new Error(`No draft JSON or markdown file found in directory: ${fullPath}`);
      }
      const parsed = parseMarkdown(path.join(fullPath, found));
      sourceContent = parsed.contentMarkdown || '';
      if (parsed.localThumbPath) {
        const candidateCover = path.resolve(fullPath, parsed.localThumbPath);
        if (fs.existsSync(candidateCover)) {
          coverPath = candidateCover;
        }
      }
    }
  } else {
    // Single markdown file mode
    const parsed = parseMarkdown(fullPath);
    sourceContent = parsed.contentMarkdown || '';
    if (parsed.localThumbPath) {
      const rawThumb = parsed.localThumbPath;
      const candidateFromCwd = path.resolve(process.cwd(), rawThumb.replace(/^\//, ''));
      const candidateFromFileDir = path.resolve(path.dirname(fullPath), rawThumb);
      if (fs.existsSync(candidateFromCwd)) {
        coverPath = candidateFromCwd;
      } else if (fs.existsSync(candidateFromFileDir)) {
        coverPath = candidateFromFileDir;
      } else if (options.strict) {
        coverPath = candidateFromCwd;
      }
    }
  }

  if (!sourceContent.trim()) {
    throw new Error(`No content found to export from ${targetPath}`);
  }

  const inlineImage = async (encodedResource: string): Promise<string> => {
    const resource = decodeHtmlEntities(encodedResource);
    if (/^(?:https?:|data:|\/\/)/i.test(resource)) return encodedResource;
    if (/^[a-z][a-z0-9+.-]*:/i.test(resource) && !resource.startsWith('local://')) {
      throw new Error(`Unsupported local image URI: ${resource}`);
    }
    const local = parseLocalPlaceholder(resource);
    const base = !local && resource.startsWith('/') ? process.cwd() : mediaBaseDir;
    const relative = local ? resource.slice('local://'.length) : resource.replace(/^\//, '');
    let localPath = relative;
    if (!isPreRenderedHtml) {
      try {
        localPath = decodeURIComponent(relative);
      } catch (error) {
        // The SDK preserves literal percent signs in otherwise valid filenames.
        if (!(error instanceof URIError)) throw error;
      }
    }
    const file = resolveContainedFile(base, localPath);
    return readPortableImage(file);
  };

  // 1. Render Markdown to Inlined WeChat HTML (skip if already HTML from draft.json)
  let baseHtml = sourceContent;
  if (!isPreRenderedHtml) {
    const normalizedMd = normalizeJekyllMarkdown(sourceContent);
    // Preserve local resources through SDK URL sanitization without rewriting code examples.
    const localSchemeMarker = `https://wechat-export-${randomUUID()}.invalid/`;
    const visible = maskProtectedRegions(normalizedMd);
    const renderSource = replaceSourceRegions(normalizedMd, [...visible.matchAll(/local:\/\//g)].map(match => ({
      start: match.index!,
      end: match.index! + match[0].length,
      replacement: localSchemeMarker,
    })));
    const themeName = options.theme || LEGACY_THEME_NAME;
    let imageError: unknown;
    const sdkResult = await renderMarkdownToWechat(renderSource, {
      theme: themeName,
      macCodeBlock: true,
      footnoteLinks: false,
      resolveImage: resource => {
        const original = decodeHtmlEntities(resource).replace(localSchemeMarker, 'local://');
        if (/^[a-z][a-z0-9+.-]*:/i.test(original)
          && !/^(?:https?:|data:)/i.test(original) && !original.startsWith('local://')) {
          imageError = new Error(`Unsupported local image URI: ${original}`);
        }
        // SDK substitutions replace arbitrary prose too; only our final img-attribute pass may inline.
        return resource;
      },
    });
    if (imageError) throw imageError;
    baseHtml = sdkResult.html.split(localSchemeMarker).join('local://');
  }

  const replacements: Record<string, string> = {};
  const scanOptions = { markdownInline: false };
  for (const resource of extractImagePaths(baseHtml, scanOptions)) {
    replacements[resource] = await inlineImage(resource);
  }
  baseHtml = replaceImagePaths(baseHtml, replacements, scanOptions);

  // 2. Run Preflight Inspection
  // Validate cover dimensions only in strict mode, consistent with publish-dir
  console.log(`🔍 Running preflight checks on ${path.basename(targetPath)}...`);
  const preflight = await runPreflightCheck({
    content: baseHtml,
    sourceMarkdown: isPreRenderedHtml ? undefined : sourceContent,
    coverPath: options.strict ? coverPath : undefined,
    strict: options.strict,
    markdownInline: scanOptions.markdownInline,
  });

  if (preflight.issues.length > 0) {
    console.log('\n--- Preflight Findings ---');
    for (const issue of preflight.issues) {
      const tag = issue.severity === 'error' ? '❌ [ERROR]' : '⚠️  [WARN]';
      console.log(`${tag} ${issue.message}`);
    }
    console.log('--------------------------\n');
  }

  if (!preflight.passed) {
    throw new Error('Preflight checks failed with errors. Aborting export (use without --strict or resolve errors).');
  }

  // 3. Process Links & Footnotes
  const useFootnotes = options.footnotes ?? true;
  const { html: finalHtml, footnotes } = normalizeLinksAndFootnotes(baseHtml, {
    appendSection: useFootnotes,
  });

  // 4. Output / Clipboard
  if (options.output) {
    const outPath = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, finalHtml, 'utf8');
    console.log(`✅ Saved formatted HTML to: ${outPath}`);
  }

  if (options.clip) {
    console.log('📋 Copying rich-text HTML into system clipboard...');
    const clipResult = await copyRichTextToClipboard(finalHtml);
    if (clipResult.success) {
      console.log('🎉 Success! Rich-text copied to clipboard. You can now paste (⌘+V) directly into WeChat Official Account editor.');
    } else {
      throw new Error(`Failed to copy rich-text to clipboard: ${clipResult.error}`);
    }
  }

  if (!options.clip && !options.output) {
    console.log(`\n✨ Rendered ${finalHtml.length} bytes of WeChat inline HTML with ${footnotes.length} footnotes.`);
    console.log('💡 Tip: pass --clip to copy directly to clipboard, or -o output.html to save.');
  }
}
