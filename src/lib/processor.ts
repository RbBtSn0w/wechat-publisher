import { parseMarkdown, convertMarkdownToHtml, extractImagePaths, replaceImagePaths, extractMermaidBlocks, replaceMermaidBlocks } from './parser';
import { inlineCss } from './converter';
import { BlogPost, AppConfig } from '../types';
import { Uploader } from './uploader';
import { ResourceCache } from './cache';
import { MermaidRenderer } from './mermaid-renderer';
import { getRepoRoot } from './constants';
import path from 'path';
import fs from 'fs';

export async function processPost(filePath: string, config: AppConfig, uploader?: Uploader): Promise<BlogPost> {
  const repoRoot = getRepoRoot();
  const postInfo = parseMarkdown(filePath);
  
  if (!postInfo.contentMarkdown) {
    throw new Error('Post content is empty.');
  }

  let finalMarkdown = postInfo.contentMarkdown;
  const cache = new ResourceCache();

  // 1. Process Mermaid Blocks -> Convert to static images
  const mermaidBlocks = extractMermaidBlocks(finalMarkdown);
  if (mermaidBlocks.length > 0) {
    console.log(`🚀 Found ${mermaidBlocks.length} Mermaid blocks. Converting to images...`);
    const renderer = new MermaidRenderer();
    const mermaidReplacements: Record<string, string> = {};

    const mermaidPromises = mermaidBlocks.map(async (code) => {
      try {
        const hash = renderer.getHash(code);
        const cacheKey = `mermaid:${hash}`;
        let wechatUrl = cache.get(cacheKey);

        if (!wechatUrl) {
          const localImgPath = await renderer.renderToImage(code);
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
        } else {
          mermaidReplacements[code] = `> 📊 [Mermaid Diagram - Pending Sync]`;
        }
      } catch (e: any) {
        console.error(`Failed to render Mermaid block: ${e.message}`);
      }
    });

    await Promise.all(mermaidPromises);
    finalMarkdown = replaceMermaidBlocks(finalMarkdown, mermaidReplacements);
  }

  // 2. Process Normal Images
  if (uploader) {
    const imagePaths = extractImagePaths(finalMarkdown);
    const replacements: Record<string, string> = {};

    const uploadPromises = imagePaths.map(async (imgPath) => {
      if (imgPath.startsWith('http')) return null;
      
      let localImgPath = imgPath;
      if (imgPath.startsWith('/')) {
        localImgPath = path.join(repoRoot, imgPath);
      } else {
        localImgPath = path.join(repoRoot, config.assetsDir || '', imgPath);
      }

      if (!fs.existsSync(localImgPath)) return null;

      let wechatUrl = cache.get(localImgPath);
      if (!wechatUrl) {
        console.log(`Uploading image: ${localImgPath}...`);
        wechatUrl = await uploader.uploadImage(localImgPath);
        cache.set(localImgPath, wechatUrl);
      }
      return { imgPath, wechatUrl };
    });

    const results = await Promise.all(uploadPromises);
    for (const res of results) {
      if (res) replacements[res.imgPath] = res.wechatUrl;
    }

    // Apply replacements to Markdown
    for (const [oldPath, newPath] of Object.entries(replacements)) {
      finalMarkdown = finalMarkdown.split(oldPath).join(newPath);
    }

    // Handle Cover Image
    if (postInfo.localThumbPath) {
      let localThumbPath = postInfo.localThumbPath;
      if (!localThumbPath.startsWith('/')) {
        localThumbPath = path.join(repoRoot, config.assetsDir || '', localThumbPath);
      } else {
        localThumbPath = path.join(repoRoot, localThumbPath);
      }

      if (fs.existsSync(localThumbPath)) {
        let thumbMediaId = cache.get(`thumb:${localThumbPath}`);
        if (!thumbMediaId) {
          console.log(`Uploading cover image: ${localThumbPath}...`);
          thumbMediaId = await uploader.uploadPermanentImage(localThumbPath);
          cache.set(`thumb:${localThumbPath}`, thumbMediaId);
        }
        postInfo.wechatThumbMediaId = thumbMediaId;
      }
    }
  }

  // 3. Convert to HTML
  const rawHtml = convertMarkdownToHtml(finalMarkdown);
  
  // 4. Inline CSS (Includes link resolution)
  let contentHtml = inlineCss(rawHtml, config.siteUrl, config.style);

  // 5. Extra safety for any remaining relative image paths in HTML
  if (uploader || !uploader) {
    const allImagePaths = extractImagePaths(postInfo.contentMarkdown || '');
    for (const imgPath of allImagePaths) {
      let localImgPath = imgPath;
      if (imgPath.startsWith('/')) {
        localImgPath = path.join(repoRoot, imgPath);
      } else {
        localImgPath = path.join(repoRoot, config.assetsDir || '', imgPath);
      }
      
      const wechatUrl = cache.get(localImgPath);
      if (wechatUrl) {
        const escapedPath = imgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`src=["']${escapedPath}["']`, 'g');
        contentHtml = contentHtml.replace(regex, `src="${wechatUrl}"`);
      }
    }
  }

  return {
    title: postInfo.title || 'Untitled',
    author: postInfo.author || '',
    digest: postInfo.digest || '',
    contentMarkdown: finalMarkdown,
    contentHtml,
    localThumbPath: postInfo.localThumbPath || '',
    wechatThumbMediaId: postInfo.wechatThumbMediaId || '',
    originalPath: filePath,
  };
}
