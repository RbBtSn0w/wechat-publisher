import fs from 'fs';
import path from 'path';
import { normalizeJekyllMarkdown, parseMarkdown, extractImagePaths, replaceImagePaths } from '../lib/parser';
import { readPortableImage, resolveContainedFile } from '../lib/media';
import { renderMarkdownToWechat } from '@rbbtsn0w/wechat-markdown';
import { LEGACY_THEME_NAME } from '../lib/theme-registry';
import { normalizeLinksAndFootnotes } from '../lib/converter';
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

  const replacements: Record<string, string> = {};
  const scanOptions = { markdownInline: !isPreRenderedHtml };
  for (const resource of extractImagePaths(sourceContent, scanOptions)) {
    if (/^(?:https?:|data:|\/\/)/i.test(resource)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(resource) && !resource.startsWith('local://')) {
      throw new Error(`Unsupported local image URI: ${resource}`);
    }
    const local = parseLocalPlaceholder(resource);
    const base = !local && resource.startsWith('/') ? process.cwd() : mediaBaseDir;
    const relative = local ? resource.slice('local://'.length) : resource.replace(/^\//, '');
    const file = resolveContainedFile(base, relative);
    replacements[resource] = await readPortableImage(file);
  }
  sourceContent = replaceImagePaths(sourceContent, replacements, scanOptions);

  // 1. Run Preflight Inspection
  // Validate cover dimensions only in strict mode, consistent with publish-dir
  console.log(`🔍 Running preflight checks on ${path.basename(targetPath)}...`);
  const preflight = await runPreflightCheck({
    content: sourceContent,
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

  // 2. Render Markdown to Inlined WeChat HTML (skip if already HTML from draft.json)
  let baseHtml = sourceContent;
  if (!isPreRenderedHtml) {
    const normalizedMd = normalizeJekyllMarkdown(sourceContent);
    const themeName = options.theme || LEGACY_THEME_NAME;
    const sdkResult = await renderMarkdownToWechat(normalizedMd, {
      theme: themeName,
      macCodeBlock: true,
      footnoteLinks: false,
    });
    baseHtml = sdkResult.html;
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
