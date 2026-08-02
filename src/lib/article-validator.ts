import {
  ConversionDiagnostic,
  DEFAULT_SYNC_LIMITS,
  SyncLimits,
  WeChatArticleType,
} from '../types';

export interface ArticleValidationInput {
  title: string;
  author: string;
  digest: string;
  content: string;
  thumbMediaId: string;
  articleType: WeChatArticleType;
}

export function validateArticle(
  article: ArticleValidationInput,
  configuredLimits?: Partial<SyncLimits>
): ConversionDiagnostic[] {
  const limits = { ...DEFAULT_SYNC_LIMITS, ...configuredLimits };
  const diagnostics: ConversionDiagnostic[] = [];

  const checkLength = (value: string, limit: number, code: string, label: string) => {
    if (value.length > limit) {
      diagnostics.push({
        code,
        severity: 'error',
        message: `${label} exceeds ${limit} characters (actual: ${value.length}).`,
      });
    }
  };

  checkLength(article.title, limits.title, 'ARTICLE_TITLE_TOO_LONG', 'Article title');
  checkLength(article.author, limits.author, 'ARTICLE_AUTHOR_TOO_LONG', 'Article author');
  checkLength(article.digest, limits.digest, 'ARTICLE_DIGEST_TOO_LONG', 'Article digest');
  checkLength(article.content, limits.contentCharacters, 'ARTICLE_CONTENT_TOO_LONG', 'Article content');

  const contentBytes = Buffer.byteLength(article.content, 'utf8');
  if (contentBytes > limits.contentBytes) {
    diagnostics.push({
      code: 'ARTICLE_CONTENT_BYTES_TOO_LARGE',
      severity: 'error',
      message: `Article content exceeds ${limits.contentBytes} UTF-8 bytes (actual: ${contentBytes}).`,
    });
  }

  if (article.articleType === 'news' && article.thumbMediaId.trim().length === 0) {
    diagnostics.push({
      code: 'ARTICLE_COVER_REQUIRED',
      severity: 'error',
      message: 'News articles require a permanent thumb_media_id.',
    });
  }

  if (article.articleType === 'newspic' && article.thumbMediaId.trim().length > 0) {
    diagnostics.push({
      code: 'ARTICLE_COVER_UNSUPPORTED',
      severity: 'warning',
      message: 'Newspic articles do not use thumb_media_id.',
    });
  }

  return diagnostics;
}

export class ArticleValidationError extends Error {
  constructor(public readonly diagnostics: ConversionDiagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join(' '));
    this.name = 'ArticleValidationError';
  }
}

export function assertValidArticle(
  article: ArticleValidationInput,
  configuredLimits?: Partial<SyncLimits>
): void {
  const diagnostics = validateArticle(article, configuredLimits).filter(
    diagnostic => diagnostic.severity === 'error'
  );
  if (diagnostics.length > 0) throw new ArticleValidationError(diagnostics);
}
