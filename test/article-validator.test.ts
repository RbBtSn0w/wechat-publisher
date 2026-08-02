import { expect, test } from 'vitest';
import { assertValidArticle, validateArticle } from '../src/lib/article-validator';

const baseArticle = {
  title: 'Title',
  author: 'Author',
  digest: 'Digest',
  content: '<p>Body</p>',
  thumbMediaId: 'MEDIA_ID',
  articleType: 'news' as const,
};

test('validateArticle accepts a normal news article', () => {
  expect(validateArticle(baseArticle)).toEqual([]);
});

test('validateArticle reports character and byte limits before API calls', () => {
  const diagnostics = validateArticle({
    ...baseArticle,
    title: 'x'.repeat(65),
    content: '汉'.repeat(20),
  }, { contentCharacters: 10, contentBytes: 20 });

  expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
    'ARTICLE_TITLE_TOO_LONG',
    'ARTICLE_CONTENT_TOO_LONG',
    'ARTICLE_CONTENT_BYTES_TOO_LARGE',
  ]);
});

test('assertValidArticle rejects a news article without a cover', () => {
  expect(() => assertValidArticle({ ...baseArticle, thumbMediaId: '' })).toThrow(
    /permanent thumb_media_id/
  );
});

test('validateArticle only warns about a cover on newspic articles', () => {
  const diagnostics = validateArticle({
    ...baseArticle,
    articleType: 'newspic',
  });
  expect(diagnostics).toEqual([
    expect.objectContaining({ code: 'ARTICLE_COVER_UNSUPPORTED', severity: 'warning' }),
  ]);
});
