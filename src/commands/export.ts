import fs from 'fs';
import path from 'path';
import { normalizeJekyllMarkdown, parseMarkdown } from '../lib/parser';
import { registerTheme, renderMarkdownToWechat } from '@rbbtsn0w/wechat-markdown';
import { techTheme } from '../lib/themes/tech';
import { normalizeLinksAndFootnotes } from '../lib/converter';
import { copyRichTextToClipboard } from '../lib/clipboard';
import { runPreflightCheck } from '../lib/preflight';
import {
  parseLocalPlaceholder,
  readDraftPayloadFromDirectory,
  resolveLocalFile,
} from '../lib/directory-draft';

const LEGACY_THEME_NAME = 'wechat-publisher-legacy';
registerTheme(LEGACY_THEME_NAME, techTheme);

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

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
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

      // Replace local:// image placeholders in HTML with resolved local paths for offline export
      const localMatches = sourceContent.match(/local:\/\/[^\s"'<>]+/g) || [];
      for (const placeholder of Array.from(new Set(localMatches))) {
        const localFile = resolveLocalFile(fullPath, placeholder);
        sourceContent = sourceContent.split(placeholder).join(localFile);
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

  // 1. Run Preflight Inspection
  console.log(`🔍 Running preflight checks on ${path.basename(targetPath)}...`);
  const preflight = await runPreflightCheck({
    content: sourceContent,
    coverPath,
    strict: options.strict,
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
      console.warn(`⚠️ Clipboard warning: ${clipResult.error}`);
    }
  }

  if (!options.clip && !options.output) {
    console.log(`\n✨ Rendered ${finalHtml.length} bytes of WeChat inline HTML with ${footnotes.length} footnotes.`);
    console.log('💡 Tip: pass --clip to copy directly to clipboard, or -o output.html to save.');
  }
}
