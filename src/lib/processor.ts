import {
  parseMarkdown, extractImagePaths, replaceImagePaths, extractMermaidBlocks,
  replaceMermaidBlocks, normalizeJekyllMarkdown, findUnsupportedMarkdown,
  extractMathExpressions, replaceMathExpressions,
} from './parser';
import { neuterLinksToSpans } from './converter';
import { AppConfig, BlogPost, ConversionDiagnostic, ConversionStats, ProcessResult } from '../types';
import { Uploader } from './uploader';
import { cacheScope, fingerprintFile, ResourceCache } from './cache';
import { MermaidRenderer } from './mermaid-renderer';
import { FormulaRenderer } from './formula-renderer';
import { RemoteImageDownloader } from './remote-image';
import { ArticleValidationError, validateArticle } from './article-validator';
import { getRepoRoot } from './constants';
import { validateUploadableImage, readValidatedUploadImage, resolveContainedFile } from './media';
import { validatePlaceholderText } from './preflight';
import { renderMarkdownToWechat } from '@rbbtsn0w/wechat-markdown';
import { LEGACY_THEME_NAME } from './theme-registry';
import path from 'path';
import { createHash } from 'crypto';
import fs from 'fs';

export interface MermaidRenderService {
  getHash(mermaidCode: string): string;
  renderToImage(mermaidCode: string): Promise<string>;
}
export interface FormulaRenderService {
  getHash(expression: string, display: boolean): string;
  renderToImage(expression: string, display: boolean): Promise<string>;
}
export interface ImageDownloadService { download(url: string): Promise<string> }
export interface ProcessServices {
  mermaidRenderer?: MermaidRenderService;
  formulaRenderer?: FormulaRenderService;
  remoteImageDownloader?: ImageDownloadService;
}

interface PreparedAsset { localPath: string; fingerprint: string; token?: string }
export interface PreparedPost {
  result: ProcessResult;
  images: PreparedAsset[];
  cover?: PreparedAsset;
  config: AppConfig;
  htmlTemplate: string;
}

function resolveLocalAssetPath(repoRoot: string, assetPath: string, assetsDir: string): string {
  if (path.isAbsolute(assetPath)) {
    const repositoryPath = path.join(repoRoot, assetPath);
    if (fs.existsSync(repositoryPath)) return resolveContainedFile(repoRoot, assetPath.replace(/^\/+/, ''));
    if (!fs.existsSync(assetPath)) throw new Error(`Image not found: ${assetPath}`);
    // Explicit filesystem paths remain supported within the configured assets root.
    const base = path.resolve(repoRoot, assetsDir || '.');
    return resolveContainedFile(base, path.relative(base, assetPath));
  }
  try {
    return resolveContainedFile(path.resolve(repoRoot, assetsDir || '.'), assetPath.replace(/^local:\/\//, ''));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Image not found: ${assetPath}`);
    throw error;
  }
}

function assertContent(result: ProcessResult, config: AppConfig, requireCover: boolean, content = result.post.contentHtml): void {
  const post = result.post;
  const diagnostics = validateArticle({
    title: post.title, author: post.author, digest: post.digest, content,
    thumbMediaId: requireCover ? post.wechatThumbMediaId : 'preview-cover', articleType: post.articleType,
  }, config.limits).filter(issue => issue.severity === 'error');
  if (diagnostics.length) throw new ArticleValidationError(diagnostics);
}

/** Prepare and validate every resource without calling a WeChat write endpoint. */
export async function preparePostWithReport(
  filePath: string, config: AppConfig, services: ProcessServices = {}, requireCover = false
): Promise<PreparedPost> {
  const repoRoot = getRepoRoot();
  const info = parseMarkdown(filePath);
  if (!info.contentMarkdown?.trim()) throw new Error('Post content is empty.');
  let markdown = normalizeJekyllMarkdown(info.contentMarkdown);
  const diagnostics: ConversionDiagnostic[] = findUnsupportedMarkdown(markdown, filePath);
  if (diagnostics.some(issue => issue.severity === 'error')) {
    throw new Error(diagnostics.map(issue => `${issue.message} (${filePath}:${issue.line})`).join(' '));
  }
  const stats: ConversionStats = {
    uploadedImages: 0, uploadedCovers: 0, renderedMermaid: 0, renderedFormulas: 0, degradedMermaid: 0,
  };
  const articleType = info.articleType || 'news';
  if (requireCover && articleType === 'news' && !info.localThumbPath && !info.wechatThumbMediaId) {
    throw new Error('News articles require a cover image or permanent thumb_media_id before asset processing.');
  }
  const metadataErrors = validateArticle({
    title: info.title || 'Untitled', author: info.author || config.author || '', digest: info.digest || '',
    content: '', thumbMediaId: 'preflight', articleType,
  }, config.limits).filter(issue => issue.severity === 'error' && !issue.code.startsWith('ARTICLE_CONTENT_'));
  if (metadataErrors.length) throw new ArticleValidationError(metadataErrors);

  let cover: PreparedAsset | undefined;
  if (info.localThumbPath) {
    const localPath = resolveLocalAssetPath(repoRoot, info.localThumbPath, config.assetsDir);
    await validateUploadableImage(localPath, 'permanent');
    cover = { localPath, fingerprint: fingerprintFile(localPath) };
  }
  const generated = new Set<string>();
  const math = extractMathExpressions(markdown);
  if (math.length) {
    const renderer = services.formulaRenderer || new FormulaRenderer();
    const replacements: Record<string, string> = {};
    for (const expression of math) {
      const localPath = await renderer.renderToImage(expression.expression, expression.display);
      replacements[expression.key] = `![Formula](<${localPath}>)`;
      generated.add(localPath);
      stats.renderedFormulas++;
    }
    markdown = replaceMathExpressions(markdown, replacements);
  }
  const mermaid = extractMermaidBlocks(markdown);
  if (mermaid.length) {
    const renderer = services.mermaidRenderer || new MermaidRenderer();
    const replacements: Record<string, string> = {};
    for (const code of mermaid) {
      try {
        const localPath = await renderer.renderToImage(code);
        replacements[code] = `![Mermaid Diagram](<${localPath}>)`;
        generated.add(localPath);
        stats.renderedMermaid++;
      } catch (error: unknown) {
        replacements[code] = '> 📊 [Mermaid Diagram - Pending Sync]';
        stats.degradedMermaid++;
        diagnostics.push({ code: 'MERMAID_RENDER_DEGRADED', severity: 'warning',
          message: `Mermaid rendering failed: ${error instanceof Error ? error.message : 'render unavailable'}`,
          sourcePath: filePath, resource: renderer.getHash(code) });
      }
    }
    markdown = replaceMermaidBlocks(markdown, replacements);
  }
  const downloader = services.remoteImageDownloader || new RemoteImageDownloader();
  const replacements: Record<string, string> = {};
  const assets = new Map<string, PreparedAsset>();
  for (const source of extractImagePaths(markdown)) {
    const localPath = generated.has(source) ? source : /^https?:\/\//i.test(source)
      ? await downloader.download(source) : resolveLocalAssetPath(repoRoot, source, config.assetsDir);
    await validateUploadableImage(localPath, 'content');
    replacements[source] = localPath;
    if (!assets.has(localPath)) assets.set(localPath, { localPath, fingerprint: fingerprintFile(localPath),
      token: `https://wechat-publisher.invalid/resource/${assets.size}` });
  }
  markdown = replaceImagePaths(markdown, replacements);
  const placeholders = validatePlaceholderText(markdown).filter(issue => issue.severity === 'error');
  if (placeholders.length) throw new Error(placeholders.map(issue => issue.message).join(' '));
  // Bind resource identities before the SDK encodes destinations or HTML attributes.
  const tokens = Object.fromEntries([...assets.values()].map(asset => [asset.localPath, asset.token!]));
  const rendered = await renderMarkdownToWechat(replaceImagePaths(markdown, tokens), {
    theme: LEGACY_THEME_NAME, siteUrl: config.siteUrl, renderMath: false, renderMermaid: false,
    footnoteLinks: false, gfmAlerts: false, macCodeBlock: true, tableScroller: false,
  });
  diagnostics.push(...rendered.diagnostics.filter(issue => issue.code !== 'LOCAL_IMAGE_UNRESOLVED')
    .map(issue => ({ ...issue, sourcePath: filePath })));
  const htmlTemplate = neuterLinksToSpans(rendered.html);
  const preparedTokens = new Set([...assets.values()].map(asset => asset.token!));
  if (extractImagePaths(htmlTemplate, { markdownInline: false }).some(resource => !preparedTokens.has(resource))) {
    throw new Error('An image reference was not prepared. Use inline Markdown image syntax before publishing.');
  }
  const previewPaths = Object.fromEntries([...assets.values()].map(asset => [asset.token!,
    asset.localPath.split('/').map(encodeURIComponent).join('/')]));
  const result: ProcessResult = { post: {
    title: info.title || 'Untitled', author: info.author || config.author || '', digest: info.digest || '',
    contentMarkdown: markdown, contentHtml: replaceImagePaths(htmlTemplate, previewPaths, { markdownInline: false }),
    localThumbPath: info.localThumbPath || '', wechatThumbMediaId: info.wechatThumbMediaId || '',
    articleType, originalPath: filePath,
  }, diagnostics, stats };
  // Unknown CDN URL lengths cannot be inferred from machine-specific preview paths.
  // Reject only a deterministic lower bound here, then check real URLs after upload.
  const minimumPaths = Object.fromEntries([...assets.values()].map(asset => [asset.token!, '']));
  assertContent(result, config, false, replaceImagePaths(htmlTemplate, minimumPaths, { markdownInline: false }));
  return { result, images: [...assets.values()], cover, config, htmlTemplate };
}

/** Execute only a successfully prepared post; unknown writes propagate without replay. */
export async function executePreparedPost(prepared: PreparedPost, uploader: Uploader): Promise<ProcessResult> {
  const { config } = prepared;
  const result: ProcessResult = {
    post: { ...prepared.result.post }, diagnostics: [...prepared.result.diagnostics], stats: { ...prepared.result.stats },
  };
  const snapshots = new Map<PreparedAsset, Buffer>();
  for (const asset of [...prepared.images, ...(prepared.cover ? [prepared.cover] : [])]) {
    const bytes = await readValidatedUploadImage(asset.localPath, asset === prepared.cover ? 'permanent' : 'content');
    snapshots.set(asset, bytes);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.fingerprint) throw new Error('Prepared image changed; run preflight again.');
  }
  const cache = new ResourceCache({ scope: cacheScope(config) });
  const replacements: Record<string, string> = {};
  for (const asset of prepared.images) {
    replacements[asset.localPath] = await cache.getOrUpload(`url:${asset.localPath}`, asset.fingerprint, async () => {
      const url = await uploader.uploadImage(asset.localPath, snapshots.get(asset));
      result.stats.uploadedImages++;
      return url;
    });
  }
  result.post.contentMarkdown = replaceImagePaths(result.post.contentMarkdown, replacements);
  const htmlReplacements = Object.fromEntries(prepared.images.map(asset => [asset.token!,
    new URL(replacements[asset.localPath]).href.replace(/&/g, '&amp;')]));
  result.post.contentHtml = replaceImagePaths(prepared.htmlTemplate, htmlReplacements, { markdownInline: false });
  if (prepared.cover) {
    const asset = prepared.cover;
    result.post.wechatThumbMediaId = await cache.getOrUpload(`perm:${asset.localPath}`, asset.fingerprint, async () => {
      const id = await uploader.uploadPermanentImage(asset.localPath, snapshots.get(asset));
      result.stats.uploadedCovers++;
      return id;
    });
  }
  try { assertContent(result, config, true); }
  catch (error) {
    console.warn(`Final payload validation failed after asset preparation: ${result.stats.uploadedImages} body image(s), ${result.stats.uploadedCovers} cover(s) uploaded. Verify existing assets before retrying.`);
    throw error;
  }
  return result;
}

export async function processPostWithReport(
  filePath: string, config: AppConfig, uploader?: Uploader, services: ProcessServices = {}
): Promise<ProcessResult> {
  const prepared = await preparePostWithReport(filePath, config, services, Boolean(uploader));
  return uploader ? executePreparedPost(prepared, uploader) : prepared.result;
}
export async function processPost(
  filePath: string, config: AppConfig, uploader?: Uploader, services?: ProcessServices
): Promise<BlogPost> {
  return (await processPostWithReport(filePath, config, uploader, services)).post;
}
