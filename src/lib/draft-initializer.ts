import fs from 'fs';
import path from 'path';
import { WeChatArticleType } from '../types';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif']);

export type DraftInitOptions = {
  draft: WeChatArticleType;
  output: string;
  title: string;
  content: string;
  author?: string;
  digest?: string;
  cover?: string;
  images?: string[];
  needOpenComment: boolean;
  onlyFansCanComment: boolean;
  force?: boolean;
};

export type PartialDraftInitOptions = Partial<DraftInitOptions> & {
  draft?: WeChatArticleType | string;
};

export type DraftInitRuntime = {
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  defaultAuthor?: string;
};

export type DraftInitResult = {
  outputDirectory: string;
  payloadPath: string;
  imageFiles: string[];
};

function requireText(value: string | undefined, field: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeDraftType(value: string | undefined): WeChatArticleType {
  const type = value?.trim().toLowerCase();
  if (type !== 'news' && type !== 'newspic') {
    throw new Error('--draft must be either "news" or "newspic".');
  }
  return type;
}

function isYes(answer: string): boolean {
  return ['y', 'yes'].includes(answer.trim().toLowerCase());
}

function normalizeLocalImage(outputDirectory: string, file: string): string {
  const baseDirectory = path.resolve(outputDirectory);
  const absolutePath = path.resolve(baseDirectory, file.trim());
  const relativePath = path.relative(baseDirectory, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Image path is outside the draft directory: ${file}`);
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Image not found in draft directory: ${file}`);
  }
  if (!IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
    throw new Error(`Unsupported image format: ${file}`);
  }
  return relativePath.split(path.sep).join('/');
}

export function discoverDraftImages(outputDirectory: string): string[] {
  const fullDirectory = path.resolve(outputDirectory);
  if (!fs.existsSync(fullDirectory)) return [];
  if (!fs.statSync(fullDirectory).isDirectory()) {
    throw new Error(`Output path is not a directory: ${fullDirectory}`);
  }

  return fs
    .readdirSync(fullDirectory)
    .filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .filter(file => fs.statSync(path.join(fullDirectory, file)).isFile())
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function parseImageList(answer: string): string[] {
  return answer
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export async function completeDraftInitOptions(
  input: PartialDraftInitOptions,
  runtime: DraftInitRuntime
): Promise<DraftInitOptions> {
  const draft = normalizeDraftType(input.draft);
  let output = input.output?.trim();
  if (!output && runtime.interactive) {
    output = (await runtime.ask('Output directory: ')).trim();
  }
  if (!output) {
    throw new Error('--output is required when --draft is used.');
  }

  let title = input.title?.trim();
  let content = input.content?.trim();
  if (!title && runtime.interactive) title = (await runtime.ask('Title: ')).trim();
  if (!content && runtime.interactive) content = (await runtime.ask('Content: ')).trim();

  let author = input.author?.trim() || runtime.defaultAuthor?.trim();
  if (!author && runtime.interactive) {
    author = (await runtime.ask('Author (optional): ')).trim() || undefined;
  }

  let digest = input.digest?.trim();
  let cover = input.cover?.trim();
  let images = input.images?.map(item => item.trim()).filter(Boolean);
  const discoveredImages = discoverDraftImages(output);

  if (draft === 'news' && !cover && runtime.interactive) {
    if (discoveredImages.length === 1) {
      const useOnlyImage = await runtime.ask(`Use ${discoveredImages[0]} as cover? [Y/n] `);
      if (!useOnlyImage.trim() || isYes(useOnlyImage)) cover = discoveredImages[0];
    } else {
      const candidates = discoveredImages.length > 0 ? ` (${discoveredImages.join(', ')})` : '';
      cover = (await runtime.ask(`Cover image${candidates}: `)).trim();
    }
  }

  if (draft === 'news' && digest === undefined && runtime.interactive) {
    digest = (await runtime.ask('Digest (optional): ')).trim() || undefined;
  }

  if (draft === 'newspic' && (!images || images.length === 0)) {
    images = discoveredImages;
    if (runtime.interactive && images.length > 0) {
      const confirmation = await runtime.ask(`Use images in this order: ${images.join(', ')}? [Y/n] `);
      if (confirmation.trim() && !isYes(confirmation)) {
        images = parseImageList(await runtime.ask('Image files in desired order (comma-separated): '));
      }
    } else if (runtime.interactive) {
      images = parseImageList(await runtime.ask('Image files in desired order (comma-separated): '));
    }
  }

  const missing: string[] = [];
  if (!title) missing.push('--title');
  if (!content) missing.push('--content');
  if (draft === 'news' && !cover) missing.push('--cover');
  if (draft === 'newspic' && (!images || images.length === 0)) missing.push('--images');
  if (missing.length > 0) {
    throw new Error(`Missing required draft values: ${missing.join(', ')}.`);
  }

  let needOpenComment = input.needOpenComment;
  let onlyFansCanComment = input.onlyFansCanComment;
  if (needOpenComment === undefined && runtime.interactive) {
    needOpenComment = isYes(await runtime.ask('Enable comments? [y/N] '));
  }
  if (needOpenComment && onlyFansCanComment === undefined && runtime.interactive) {
    onlyFansCanComment = isYes(await runtime.ask('Only fans can comment? [y/N] '));
  }

  return {
    draft,
    output,
    title: requireText(title, 'title'),
    content: requireText(content, 'content'),
    author,
    digest,
    cover,
    images,
    needOpenComment: Boolean(needOpenComment || onlyFansCanComment),
    onlyFansCanComment: Boolean(onlyFansCanComment),
    force: Boolean(input.force),
  };
}

export function initializeDraftDirectory(options: DraftInitOptions): DraftInitResult {
  const draft = normalizeDraftType(options.draft);
  const title = requireText(options.title, 'title');
  const content = requireText(options.content, 'content');
  const outputDirectory = path.resolve(options.output);
  fs.mkdirSync(outputDirectory, { recursive: true });

  const jsonFiles = fs
    .readdirSync(outputDirectory)
    .filter(file => file.toLowerCase().endsWith('.json'));
  const payloadPath = path.join(outputDirectory, 'draft.json');
  const otherJsonFiles = jsonFiles.filter(file => file !== 'draft.json');
  if (otherJsonFiles.length > 0) {
    throw new Error(`Draft directory already contains another JSON file: ${otherJsonFiles.join(', ')}`);
  }
  if (fs.existsSync(payloadPath) && !options.force) {
    throw new Error(`Draft payload already exists: ${payloadPath}. Use --force to overwrite it.`);
  }

  const common = {
    article_type: draft,
    title,
    ...(options.author?.trim() ? { author: options.author.trim() } : {}),
    content,
  };
  const needOpenComment = options.needOpenComment || options.onlyFansCanComment ? 1 : 0;
  const onlyFansCanComment = options.onlyFansCanComment ? 1 : 0;
  let article: Record<string, unknown>;
  let imageFiles: string[];

  if (draft === 'news') {
    const cover = normalizeLocalImage(outputDirectory, requireText(options.cover, 'cover'));
    imageFiles = [cover];
    article = {
      ...common,
      ...(options.digest?.trim() ? { digest: options.digest.trim() } : {}),
      thumb_media_id: `local://${cover}`,
      need_open_comment: needOpenComment,
      only_fans_can_comment: onlyFansCanComment,
    };
  } else {
    imageFiles = (options.images?.length ? options.images : discoverDraftImages(outputDirectory)).map(
      file => normalizeLocalImage(outputDirectory, file)
    );
    if (imageFiles.length === 0) {
      throw new Error('newspic requires at least one image. Add an image or use --images.');
    }
    if (imageFiles.length > 20) {
      throw new Error('newspic supports at most 20 images.');
    }
    article = {
      ...common,
      image_info: {
        image_list: imageFiles.map(file => ({ image_media_id: `local://${file}` })),
      },
      need_open_comment: needOpenComment,
      only_fans_can_comment: onlyFansCanComment,
    };
  }

  fs.writeFileSync(payloadPath, `${JSON.stringify({ articles: [article] }, null, 2)}\n`, 'utf8');
  return { outputDirectory, payloadPath, imageFiles };
}
