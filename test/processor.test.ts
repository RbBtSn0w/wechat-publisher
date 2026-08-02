import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';
import { processPostWithReport } from '../src/lib/processor';

function makePost(content: string): string {
  const filePath = path.join(os.tmpdir(), `wechat-post-${Date.now()}-${Math.random()}.md`);
  fs.writeFileSync(filePath, `---\ntitle: Test\n---\n${content}`);
  return filePath;
}

const config = {
  appId: '',
  appSecret: '',
  postsDir: '_posts',
  assetsDir: 'assets',
  style: 'tech',
};

test('processPostWithReport degrades Mermaid failures without leaking fences', async () => {
  const filePath = makePost(['```mermaid', 'flowchart TD', 'A --> B', '```'].join('\n'));
  const result = await processPostWithReport(filePath, config, undefined, {
    mermaidRenderer: {
      getHash: () => 'mermaid-test',
      renderToImage: async () => { throw new Error('Kroki unavailable'); },
    },
  });

  expect(result.stats.degradedMermaid).toBe(1);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: 'MERMAID_RENDER_DEGRADED', severity: 'warning' }),
  ]);
  expect(result.post.contentMarkdown).not.toContain('```mermaid');
  expect(result.post.contentMarkdown).toContain('Pending Sync');
  fs.unlinkSync(filePath);
});

test('processPostWithReport renders formulas in dry-run without requiring credentials', async () => {
  const formulaImage = path.join(os.tmpdir(), `wechat-formula-${Date.now()}.png`);
  fs.writeFileSync(formulaImage, 'png');
  const filePath = makePost('Formula: $E=mc^2$');
  const result = await processPostWithReport(filePath, config, undefined, {
    formulaRenderer: {
      getHash: () => 'formula-test',
      renderToImage: async () => formulaImage,
    },
  });

  expect(result.stats.renderedFormulas).toBe(1);
  expect(result.post.contentMarkdown).toContain(formulaImage);
  fs.unlinkSync(filePath);
  fs.unlinkSync(formulaImage);
});

test('processPostWithReport rejects unsupported footnotes before rendering', async () => {
  const filePath = makePost('Text[^1]\n\n[^1]: note');
  await expect(processPostWithReport(filePath, config)).rejects.toThrow(/footnotes/i);
  fs.unlinkSync(filePath);
});

test('processPostWithReport routes remote images through download and upload', async () => {
  const downloaded = path.join(os.tmpdir(), `wechat-remote-${Date.now()}.png`);
  fs.writeFileSync(downloaded, 'image');
  const filePath = makePost('![remote](https://example.com/image.png)');
  const uploads: string[] = [];
  const result = await processPostWithReport(filePath, config, {
    uploadImage: async (localPath: string) => {
      uploads.push(localPath);
      return 'https://mmbiz.qpic.cn/remote.png';
    },
    uploadPermanentImage: async () => 'cover-media',
  } as any, {
    remoteImageDownloader: {
      download: async () => downloaded,
    },
  });

  expect(uploads).toEqual([downloaded]);
  expect(result.post.contentMarkdown).toContain('https://mmbiz.qpic.cn/remote.png');
  expect(result.stats.uploadedImages).toBe(1);
  fs.unlinkSync(filePath);
  fs.unlinkSync(downloaded);
});

test('processPostWithReport fails instead of silently dropping a missing image', async () => {
  const filePath = makePost('![missing](/assets/does-not-exist.png)');
  await expect(processPostWithReport(filePath, config)).rejects.toThrow(/Image not found/);
  fs.unlinkSync(filePath);
});
