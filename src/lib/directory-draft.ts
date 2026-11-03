import fs from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { ResourceCache } from './cache';
import { Uploader } from './uploader';
import { readValidatedUploadImage } from './media';
import { findResourceOccurrences } from './parser';
import { replaceSourceRegions } from './source-regions';
import { runPreflightCheck } from './preflight';
import { assertValidArticle } from './article-validator';
import { SyncLimits } from '../types';

type DraftPayload = {
  articles: Record<string, unknown>[];
};

export type ResolveStats = {
  placeholderCount: number;
  permanentUploadCount: number;
  contentUploadCount: number;
};

type ResolveOptions = {
  directory: string;
  cache: ResourceCache;
  dryRun: boolean;
  uploader?: Uploader;
  limits?: Partial<SyncLimits>;
};

const LOCAL_PREFIX = 'local://';

function ensureObject(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${field} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function ensureString(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return input;
}

export function parseLocalPlaceholder(input: string): string | null {
  if (!input.startsWith(LOCAL_PREFIX)) return null;
  const relPath = input.slice(LOCAL_PREFIX.length).trim();
  if (!relPath) {
    throw new Error(`Invalid local placeholder "${input}".`);
  }
  return relPath;
}

export function resolveLocalFile(directory: string, placeholder: string): string {
  const relPath = parseLocalPlaceholder(placeholder);
  if (!relPath) {
    throw new Error(`Expected local placeholder, got "${placeholder}".`);
  }

  const baseDir = path.resolve(directory);
  const absPath = path.resolve(baseDir, relPath);
  const rel = path.relative(baseDir, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Local placeholder path escapes directory: "${placeholder}".`);
  }
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`Referenced local file not found: ${absPath}`);
  }

  // Canonical path containment: verify symlink target does not escape baseDir
  const realBaseDir = fs.realpathSync(baseDir);
  const realFilePath = fs.realpathSync(absPath);
  const realRel = path.relative(realBaseDir, realFilePath);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new Error(`Local placeholder targets file outside directory: "${placeholder}".`);
  }

  return realFilePath;
}

async function resolvePermanentMediaId(
  localPath: string,
  options: ResolveOptions,
  stats: ResolveStats
): Promise<string> {
  const bytes = await readValidatedUploadImage(localPath, 'permanent');
  if (options.dryRun) {
    return `DRYRUN_MEDIA_ID_${path.basename(localPath)}`;
  }

  if (!options.uploader) {
    throw new Error('Uploader is required when dryRun is false.');
  }

  const cacheKey = `perm:${localPath}`;
  return options.cache.getOrUpload(cacheKey, createHash('sha256').update(bytes).digest('hex'), async () => {
    const mediaId = await options.uploader!.uploadPermanentImage(localPath, bytes);
    stats.permanentUploadCount += 1;
    return mediaId;
  });
}

async function resolveContentImageUrl(
  localPath: string,
  options: ResolveOptions,
  stats: ResolveStats
): Promise<string> {
  const bytes = await readValidatedUploadImage(localPath, 'content');
  if (options.dryRun) {
    return `DRYRUN_URL_${path.basename(localPath)}`;
  }

  if (!options.uploader) {
    throw new Error('Uploader is required when dryRun is false.');
  }

  const cacheKey = `url:${localPath}`;
  return options.cache.getOrUpload(cacheKey, createHash('sha256').update(bytes).digest('hex'), async () => {
    const url = await options.uploader!.uploadImage(localPath, bytes);
    stats.contentUploadCount += 1;
    return url;
  });
}

async function replaceLocalPlaceholdersInContent(
  content: string,
  options: ResolveOptions,
  stats: ResolveStats
): Promise<string> {
  const matches = findResourceOccurrences(content, { markdownInline: false }).filter(item => item.path.startsWith(LOCAL_PREFIX));
  const uniq = Array.from(new Set(matches.map(item => item.path)));
  if (uniq.length === 0) return content;

  const replacements: Record<string, string> = {};
  for (const placeholder of uniq) {
    const localPath = resolveLocalFile(options.directory, placeholder);
    const url = await resolveContentImageUrl(localPath, options, stats);
    stats.placeholderCount += 1;
    replacements[placeholder] = url;
  }
  return replaceSourceRegions(content, matches.map(item => ({ ...item, replacement: replacements[item.path] })));
}

function normalizeArticleType(article: Record<string, unknown>, index: number): 'news' | 'newspic' {
  const raw = article.article_type;
  const type = (typeof raw === 'string' ? raw : 'news').trim().toLowerCase();
  if (type !== 'news' && type !== 'newspic') {
    throw new Error(`articles[${index}].article_type must be "news" or "newspic".`);
  }
  article.article_type = type;
  return type;
}

async function resolveNewsArticle(
  article: Record<string, unknown>,
  index: number,
  options: ResolveOptions,
  stats: ResolveStats
) {
  const thumbRaw = article.thumb_media_id;
  if (typeof thumbRaw === 'string' && parseLocalPlaceholder(thumbRaw)) {
    const localPath = resolveLocalFile(options.directory, thumbRaw);
    const mediaId = await resolvePermanentMediaId(localPath, options, stats);
    stats.placeholderCount += 1;
    article.thumb_media_id = mediaId;
  }

  ensureString(article.thumb_media_id, `articles[${index}].thumb_media_id`);
}

async function resolveNewspicArticle(
  article: Record<string, unknown>,
  index: number,
  options: ResolveOptions,
  stats: ResolveStats
) {
  const imageInfo = ensureObject(article.image_info, `articles[${index}].image_info`);
  const imageList = imageInfo.image_list;
  if (!Array.isArray(imageList) || imageList.length === 0) {
    throw new Error(`articles[${index}].image_info.image_list must be a non-empty array.`);
  }
  if (imageList.length > 20) {
    throw new Error(`articles[${index}].image_info.image_list exceeds 20 images.`);
  }

  for (let i = 0; i < imageList.length; i += 1) {
    const imageItem = ensureObject(imageList[i], `articles[${index}].image_info.image_list[${i}]`);
    const imageMediaId = ensureString(
      imageItem.image_media_id,
      `articles[${index}].image_info.image_list[${i}].image_media_id`
    );
    if (parseLocalPlaceholder(imageMediaId)) {
      const localPath = resolveLocalFile(options.directory, imageMediaId);
      imageItem.image_media_id = await resolvePermanentMediaId(localPath, options, stats);
      stats.placeholderCount += 1;
    }
  }
}

export function discoverDraftDirectories(directory: string): string[] {
  const targetDir = path.resolve(directory);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const jsonFiles = fs
    .readdirSync(targetDir)
    .filter(file => file.toLowerCase().endsWith('.json'));

  if (jsonFiles.length === 1) {
    return [targetDir];
  }

  const subdirs = fs
    .readdirSync(targetDir)
    .map(name => path.join(targetDir, name))
    .filter(fullPath => {
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(subDir => {
      try {
        const jsons = fs
          .readdirSync(subDir)
          .filter(f => f.toLowerCase().endsWith('.json'));
        return jsons.length === 1;
      } catch {
        return false;
      }
    })
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'en', { numeric: true }));

  return subdirs;
}

export function readDraftPayloadFromDirectory(directory: string): DraftPayload {
  const targetDir = path.resolve(directory);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`Directory not found: ${targetDir}`);
  }

  const jsonFiles = fs
    .readdirSync(targetDir)
    .filter(file => file.toLowerCase().endsWith('.json'))
    .sort();

  if (jsonFiles.length !== 1) {
    throw new Error(
      `Expected exactly one JSON file in ${targetDir}, found ${jsonFiles.length}.`
    );
  }

  const jsonPath = path.join(targetDir, jsonFiles[0]);
  let payload: unknown;
  try {
    payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e: unknown) {
    throw new Error(`Failed to parse JSON ${jsonPath}: ${e instanceof Error ? e.message : 'invalid JSON'}`);
  }

  const obj = ensureObject(payload, 'Draft payload');
  if (!Array.isArray(obj.articles) || obj.articles.length === 0) {
    throw new Error('Draft payload.articles must be a non-empty array.');
  }

  return {
    articles: obj.articles.map((item, i) => ensureObject(item, `articles[${i}]`)),
  };
}

export async function resolveDraftPayloadMedia(
  payload: DraftPayload,
  options: ResolveOptions
): Promise<{ payload: DraftPayload; stats: ResolveStats }> {
  if (!options.dryRun) {
    // Validate every article before permitting the first irreversible upload.
    await resolveDraftPayloadMedia(payload, { ...options, dryRun: true, uploader: undefined });
  }
  const resolved: DraftPayload = JSON.parse(JSON.stringify(payload));
  const stats: ResolveStats = {
    placeholderCount: 0,
    permanentUploadCount: 0,
    contentUploadCount: 0,
  };

  for (let i = 0; i < resolved.articles.length; i += 1) {
    const article = resolved.articles[i];
    const articleType = normalizeArticleType(article, i);

    const content = ensureString(article.content, `articles[${i}].content`);
    article.content = await replaceLocalPlaceholdersInContent(content, options, stats);

    if (articleType === 'news') {
      await resolveNewsArticle(article, i, options, stats);
    } else {
      await resolveNewspicArticle(article, i, options, stats);
    }
    const preflight = await runPreflightCheck({ content: String(article.content), markdownInline: false });
    if (!preflight.passed) throw new Error(preflight.issues.map(issue => issue.message).join(' '));
    assertValidArticle({ title: typeof article.title === 'string' ? article.title : '',
      author: typeof article.author === 'string' ? article.author : '',
      digest: typeof article.digest === 'string' ? article.digest : '', content: options.dryRun ? replaceSourceRegions(content, findResourceOccurrences(content, { markdownInline: false }).filter(item => item.path.startsWith(LOCAL_PREFIX)).map(item => ({ ...item, replacement: '' }))) : String(article.content),
      thumbMediaId: typeof article.thumb_media_id === 'string' ? article.thumb_media_id : '', articleType,
    }, options.limits);
  }

  return { payload: resolved, stats };
}
