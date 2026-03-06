import { parseMarkdown, convertMarkdownToHtml, extractImagePaths, replaceImagePaths, resolveRelativeLinks } from './parser';
import { inlineCss } from './converter';
import { BlogPost, AppConfig } from '../types';
import { Uploader } from './uploader';
import { ResourceCache } from './cache';
import path from 'path';
import fs from 'fs';

export async function processPost(filePath: string, config: AppConfig, uploader?: Uploader): Promise<BlogPost> {
  const postInfo = parseMarkdown(filePath);
  
  if (!postInfo.contentMarkdown) {
    throw new Error('Post content is empty.');
  }

  let finalMarkdown = postInfo.contentMarkdown;
  const cache = new ResourceCache();

  if (uploader) {
    const imagePaths = extractImagePaths(finalMarkdown);
    const replacements: Record<string, string> = {};

    const uploadPromises = imagePaths.map(async (imgPath) => {
      if (imgPath.startsWith('http')) {
        return null;
      }
      
      let localImgPath = imgPath;
      if (imgPath.startsWith('/')) {
        localImgPath = path.join(process.cwd(), imgPath);
      } else {
        localImgPath = path.join(process.cwd(), config.assetsDir || '', imgPath.replace('/assets/img/post/', ''));
        if (!fs.existsSync(localImgPath)) {
          const directJoin = path.join(process.cwd(), imgPath.replace(/^\//, ''));
          if (fs.existsSync(directJoin)) {
             localImgPath = directJoin;
          }
        }
      }

      if (!fs.existsSync(localImgPath)) {
        console.warn(`Warning: Image not found locally, skipping upload: ${localImgPath}`);
        return null;
      }

      let wechatUrl = cache.get(localImgPath);
      if (!wechatUrl) {
        console.log(`Uploading image: ${localImgPath}...`);
        try {
          wechatUrl = await uploader.uploadImage(localImgPath);
          cache.set(localImgPath, wechatUrl);
        } catch (e: any) {
          console.error(`Failed to upload ${localImgPath}: ${e.message}`);
          return null;
        }
      }

      return { imgPath, wechatUrl };
    });

    const results = await Promise.all(uploadPromises);
    for (const res of results) {
      if (res && res.wechatUrl) {
        replacements[res.imgPath] = res.wechatUrl;
      }
    }
  } else {
    // During dry run, try to use cache if available to show what would be replaced
    const imagePaths = extractImagePaths(finalMarkdown);
    const replacements: Record<string, string> = {};
    for (const imgPath of imagePaths) {
      if (imgPath.startsWith('http')) continue;
      let localImgPath = imgPath;
      if (imgPath.startsWith('/')) {
        localImgPath = path.join(process.cwd(), imgPath);
      } else {
        localImgPath = path.join(process.cwd(), config.assetsDir || '', imgPath.replace('/assets/img/post/', ''));
      }
      const wechatUrl = cache.get(localImgPath);
      if (wechatUrl) {
        replacements[imgPath] = wechatUrl;
      }
    }
    // Apply replacements found in cache during dry run
    for (const [oldPath, newPath] of Object.entries(replacements)) {
      finalMarkdown = finalMarkdown.split(oldPath).join(newPath);
    }
  }

  // Apply real upload replacements if any
  if (uploader) {
    const imagePaths = extractImagePaths(postInfo.contentMarkdown || '');
    const replacements: Record<string, string> = {};
    for (const imgPath of imagePaths) {
      let localImgPath = imgPath;
      if (imgPath.startsWith('/')) {
        localImgPath = path.join(process.cwd(), imgPath);
      } else {
        localImgPath = path.join(process.cwd(), config.assetsDir || '', imgPath.replace('/assets/img/post/', ''));
      }
      const wechatUrl = cache.get(localImgPath);
      if (wechatUrl) {
        replacements[imgPath] = wechatUrl;
      }
    }
    for (const [oldPath, newPath] of Object.entries(replacements)) {
      finalMarkdown = finalMarkdown.split(oldPath).join(newPath);
    }
  }

  if (uploader && postInfo.localThumbPath) {
    let localThumbPath = postInfo.localThumbPath;
    if (localThumbPath.startsWith('/')) {
      localThumbPath = path.join(process.cwd(), localThumbPath);
    } else {
      localThumbPath = path.join(process.cwd(), config.assetsDir || '', localThumbPath.replace('/assets/img/post/', ''));
      if (!fs.existsSync(localThumbPath)) {
        const directJoin = path.join(process.cwd(), localThumbPath.replace(/^\//, ''));
        if (fs.existsSync(directJoin)) {
           localThumbPath = directJoin;
        }
      }
    }

    if (fs.existsSync(localThumbPath)) {
      let thumbMediaId = cache.get(`thumb:${localThumbPath}`);
      if (!thumbMediaId) {
        console.log(`Uploading cover image: ${localThumbPath}...`);
        thumbMediaId = await uploader.uploadPermanentImage(localThumbPath);
        cache.set(`thumb:${localThumbPath}`, thumbMediaId);
      }
      postInfo.wechatThumbMediaId = thumbMediaId;
    } else {
      console.warn(`Cover image not found locally: ${localThumbPath}`);
    }
  }

  const rawHtml = convertMarkdownToHtml(finalMarkdown);
  let contentHtml = inlineCss(rawHtml);

  // Extra safety: replace any remaining relative image paths in HTML using regex
  if (uploader || !uploader) { // Always try to replace if cache has it
    const allImagePaths = extractImagePaths(postInfo.contentMarkdown || '');
    for (const imgPath of allImagePaths) {
      let localImgPath = imgPath;
      if (imgPath.startsWith('/')) {
        localImgPath = path.join(process.cwd(), imgPath);
      } else {
        localImgPath = path.join(process.cwd(), config.assetsDir || '', imgPath.replace('/assets/img/post/', ''));
      }
      
      const wechatUrl = cache.get(localImgPath);
      if (wechatUrl) {
        // Replace in src attributes
        const escapedPath = imgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`src=["']${escapedPath}["']`, 'g');
        contentHtml = contentHtml.replace(regex, `src="${wechatUrl}"`);
      }
    }
  }

  if (config.siteUrl) {
    contentHtml = resolveRelativeLinks(contentHtml, config.siteUrl);
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
