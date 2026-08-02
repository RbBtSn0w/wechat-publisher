import {
  parseMarkdown,
  convertMarkdownToHtml,
  extractImagePaths,
  replaceImagePaths,
  extractMermaidBlocks,
  replaceMermaidBlocks,
  normalizeJekyllMarkdown,
  findUnsupportedMarkdown,
  extractMathExpressions,
  replaceMathExpressions,
} from './parser';
import { inlineCss } from './converter';
import { AppConfig, BlogPost, ConversionDiagnostic, ConversionStats, ProcessResult } from '../types';
import { Uploader } from './uploader';
import { fingerprintFile, ResourceCache } from './cache';
import { MermaidRenderer } from './mermaid-renderer';
import { FormulaRenderer } from './formula-renderer';
import { RemoteImageDownloader } from './remote-image';
import { ArticleValidationError, validateArticle } from './article-validator';
import { getRepoRoot } from './constants';
import path from 'path';
import fs from 'fs';

export interface MermaidRenderService {
  getHash(mermaidCode: string): string;
  renderToImage(mermaidCode: string): Promise<string>;
}

export interface FormulaRenderService {
  getHash(expression: string, display: boolean): string;
  renderToImage(expression: string, display: boolean): Promise<string>;
}

export interface ImageDownloadService {
  download(url: string): Promise<string>;
}

export interface ProcessServices {
  mermaidRenderer?: MermaidRenderService;
  formulaRenderer?: FormulaRenderService;
  remoteImageDownloader?: ImageDownloadService;
}

function resolveLocalAssetPath(repoRoot: string, assetPath: string, assetsDir: string): string {
  if (assetPath.startsWith('/')) {
    const repositoryPath = path.join(repoRoot, assetPath);
    return fs.existsSync(repositoryPath) ? repositoryPath : assetPath;
  }
  return path.join(repoRoot, assetsDir, assetPath);
}

export async function processPost(
  filePath: string,
  config: AppConfig,
  uploader?: Uploader,
  services?: ProcessServices
): Promise<BlogPost> {
  return (await processPostWithReport(filePath, config, uploader, services)).post;
}

export async function processPostWithReport(
  filePath: string,
  config: AppConfig,
  uploader?: Uploader,
  services: ProcessServices = {}
): Promise<ProcessResult> {
  const repoRoot = getRepoRoot();
  const postInfo = parseMarkdown(filePath);
  
  if (!postInfo.contentMarkdown) {
    throw new Error('Post content is empty.');
  }

  let finalMarkdown = normalizeJekyllMarkdown(postInfo.contentMarkdown);
  const diagnostics: ConversionDiagnostic[] = findUnsupportedMarkdown(finalMarkdown, filePath);
  const unsupportedErrors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (unsupportedErrors.length > 0) {
    throw new Error(unsupportedErrors.map(diagnostic => `${diagnostic.message} (${filePath}:${diagnostic.line})`).join(' '));
  }

  const metadataErrors = validateArticle({
    title: String(postInfo.title || ''),
    author: String(postInfo.author || ''),
    digest: String(postInfo.digest || ''),
    content: '',
    thumbMediaId: 'preflight',
    articleType: postInfo.articleType || 'news',
  }, config.limits).filter(diagnostic =>
    diagnostic.code.startsWith('ARTICLE_TITLE_') ||
    diagnostic.code.startsWith('ARTICLE_AUTHOR_') ||
    diagnostic.code.startsWith('ARTICLE_DIGEST_')
  );
  if (metadataErrors.length > 0) throw new ArticleValidationError(metadataErrors);

  const articleType = postInfo.articleType || 'news';
  const coverPath = postInfo.localThumbPath?.trim() || '';
  const coverMediaId = postInfo.wechatThumbMediaId?.trim() || '';
  if (uploader && articleType === 'news' && !coverPath && !coverMediaId) {
    throw new ArticleValidationError([{
      code: 'ARTICLE_COVER_REQUIRED',
      severity: 'error',
      message: 'News articles require a cover image or permanent thumb_media_id before asset processing.',
    }]);
  }
  if (coverPath) {
    const preflightCoverPath = resolveLocalAssetPath(repoRoot, coverPath, config.assetsDir || '');
    if (!fs.existsSync(preflightCoverPath)) {
      throw new Error('Cover image not found: ' + preflightCoverPath);
    }
  }

  const stats: ConversionStats = {
    uploadedImages: 0,
    uploadedCovers: 0,
    renderedMermaid: 0,
    renderedFormulas: 0,
    degradedMermaid: 0,
  };
  const cache = new ResourceCache();
  const generatedImagePaths = new Set<string>();

  // 1. Render formulas before Mermaid and image processing so all generated
  // assets use the same upload/cache path.
  const mathExpressions = extractMathExpressions(finalMarkdown);
  if (mathExpressions.length > 0) {
    const renderer = services.formulaRenderer || new FormulaRenderer();
    const replacements: Record<string, string> = {};
    await Promise.all(mathExpressions.map(async expression => {
      const localPath = await renderer.renderToImage(expression.expression, expression.display);
      if (uploader) {
        const cacheKey = `formula:${renderer.getHash(expression.expression, expression.display)}`;
        let url = cache.get(cacheKey);
        if (!url) {
          url = await uploader.uploadImage(localPath);
          cache.set(cacheKey, url);
          stats.uploadedImages += 1;
        }
        replacements[expression.key] = `![Formula](${url})`;
        generatedImagePaths.add(url);
      } else {
        replacements[expression.key] = `![Formula](${localPath})`;
        generatedImagePaths.add(localPath);
      }
      stats.renderedFormulas += 1;
    }));
    finalMarkdown = replaceMathExpressions(finalMarkdown, replacements);
  }

  // 2. Process Mermaid Blocks -> Convert to static images
  const mermaidBlocks = extractMermaidBlocks(finalMarkdown);
  if (mermaidBlocks.length > 0) {
    console.log(`🚀 Found ${mermaidBlocks.length} Mermaid blocks. Converting to images...`);
    const renderer = services.mermaidRenderer || new MermaidRenderer();
    const mermaidReplacements: Record<string, string> = {};

    const mermaidPromises = mermaidBlocks.map(async (code) => {
      try {
        const hash = renderer.getHash(code);
        const cacheKey = `mermaid:${hash}`;
        let wechatUrl = cache.get(cacheKey);
        let localImgPath: string | undefined;

        if (!wechatUrl) {
          localImgPath = await renderer.renderToImage(code);
          wechatUrl = cache.get(localImgPath);
          
          if (!wechatUrl && uploader) {
            console.log(`Uploading Mermaid diagram to WeChat...`);
            wechatUrl = await uploader.uploadImage(localImgPath);
            cache.set(localImgPath, wechatUrl);
            cache.set(cacheKey, wechatUrl);
          }
        }

        if (wechatUrl) {
          mermaidReplacements[code] = `![Mermaid Diagram](${wechatUrl})`;
          generatedImagePaths.add(wechatUrl);
          stats.renderedMermaid += 1;
        } else if (!uploader && localImgPath) {
          mermaidReplacements[code] = `![Mermaid Diagram](${localImgPath})`;
          generatedImagePaths.add(localImgPath);
          stats.renderedMermaid += 1;
        } else {
          mermaidReplacements[code] = `> 📊 [Mermaid Diagram - Pending Sync]`;
          stats.degradedMermaid += 1;
          diagnostics.push({
            code: 'MERMAID_RENDER_DEGRADED',
            severity: 'warning',
            message: 'Mermaid rendering produced no image URL; inserted a placeholder.',
            sourcePath: filePath,
            resource: renderer.getHash(code),
          });
        }
      } catch (e: any) {
        console.error(`Failed to render Mermaid block: ${e.message}`);
        // Never leak an unsupported code fence into the WeChat HTML conversion.
        mermaidReplacements[code] = '> 📊 [Mermaid Diagram - Pending Sync]';
        stats.degradedMermaid += 1;
        diagnostics.push({
          code: 'MERMAID_RENDER_DEGRADED',
          severity: 'warning',
          message: `Mermaid rendering failed: ${e.message}`,
          sourcePath: filePath,
          resource: renderer.getHash(code),
        });
      }
    });

    await Promise.all(mermaidPromises);
    finalMarkdown = replaceMermaidBlocks(finalMarkdown, mermaidReplacements);
  }

  // 3. Process Normal Images. Dry-run keeps local paths for preview; real
  // syncs upload both local and remote images to the WeChat image endpoint.
  {
    const imagePaths = extractImagePaths(finalMarkdown);
    const replacements: Record<string, string> = {};
    const remoteDownloader = services.remoteImageDownloader || new RemoteImageDownloader();

    const uploadPromises = imagePaths.map(async (imgPath) => {
      if (generatedImagePaths.has(imgPath)) return null;
      try {
        let localImgPath = imgPath;
        if (/^https?:\/\//i.test(imgPath)) {
          localImgPath = await remoteDownloader.download(imgPath);
        } else {
          localImgPath = resolveLocalAssetPath(repoRoot, imgPath, config.assetsDir || '');
        }

        if (!fs.existsSync(localImgPath)) {
          throw new Error(`Image not found: ${localImgPath}`);
        }

        if (!uploader) return { imgPath, wechatUrl: localImgPath };

        const fingerprint = fingerprintFile(localImgPath);
        let wechatUrl = cache.get(localImgPath, fingerprint);
        if (!wechatUrl) {
          console.log(`Uploading image: ${localImgPath}...`);
          wechatUrl = await uploader.uploadImage(localImgPath);
          cache.set(localImgPath, wechatUrl, fingerprint);
          stats.uploadedImages += 1;
        }
        return { imgPath, wechatUrl };
      } catch (error: any) {
        throw new Error(`Failed to prepare image "${imgPath}": ${error.message}`);
      }
    });

    const results = await Promise.all(uploadPromises);
    for (const res of results) {
      if (res) replacements[res.imgPath] = res.wechatUrl;
    }

    // Apply replacements without changing prose or Markdown image titles.
    finalMarkdown = replaceImagePaths(finalMarkdown, replacements);

    // Handle Cover Image for real sync. Dry-run still verifies that a declared
    // local cover exists, but does not need a media id.
    if (postInfo.localThumbPath) {
      let localThumbPath = postInfo.localThumbPath;
      localThumbPath = resolveLocalAssetPath(repoRoot, localThumbPath, config.assetsDir || '');

      if (!fs.existsSync(localThumbPath)) {
        throw new Error(`Cover image not found: ${localThumbPath}`);
      }
      if (uploader) {
        const fingerprint = fingerprintFile(localThumbPath);
        let thumbMediaId = cache.get(`thumb:${localThumbPath}`, fingerprint);
        if (!thumbMediaId) {
          console.log(`Uploading cover image: ${localThumbPath}...`);
          thumbMediaId = await uploader.uploadPermanentImage(localThumbPath);
          cache.set(`thumb:${localThumbPath}`, thumbMediaId, fingerprint);
          stats.uploadedCovers += 1;
        }
        postInfo.wechatThumbMediaId = thumbMediaId;
      }
    }
  }

  // 4. Convert to HTML
  const rawHtml = convertMarkdownToHtml(finalMarkdown);
  
  // 5. Inline CSS (Includes link resolution)
  let contentHtml = inlineCss(rawHtml, config.siteUrl, config.style);

  const contentErrors = validateArticle({
    title: String(postInfo.title || ''),
    author: String(postInfo.author || ''),
    digest: String(postInfo.digest || ''),
    content: contentHtml,
    thumbMediaId: postInfo.wechatThumbMediaId || 'dry-run-cover',
    articleType: postInfo.articleType || 'news',
  }, config.limits).filter(diagnostic =>
    diagnostic.code.startsWith('ARTICLE_CONTENT_')
  );
  if (contentErrors.length > 0) throw new ArticleValidationError(contentErrors);

  // 6. Extra safety for any remaining relative image paths in HTML
  {
    const allImagePaths = extractImagePaths(postInfo.contentMarkdown || '');
    for (const imgPath of allImagePaths) {
      let localImgPath = imgPath;
      localImgPath = resolveLocalAssetPath(repoRoot, imgPath, config.assetsDir || '');
      
      const wechatUrl = cache.get(localImgPath);
      if (wechatUrl) {
        const escapedPath = imgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`src=["']${escapedPath}["']`, 'g');
        contentHtml = contentHtml.replace(regex, `src="${wechatUrl}"`);
      }
    }
  }

  return {
    post: {
      title: postInfo.title || 'Untitled',
      author: postInfo.author || '',
      digest: postInfo.digest || '',
      contentMarkdown: finalMarkdown,
      contentHtml,
      localThumbPath: postInfo.localThumbPath || '',
      wechatThumbMediaId: postInfo.wechatThumbMediaId || '',
      articleType: postInfo.articleType || 'news',
      originalPath: filePath,
    },
    diagnostics,
    stats,
  };
}
