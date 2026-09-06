import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';
import { processPostWithReport } from '../src/lib/processor';

function makePost(content: string, metadata: string = 'title: Test'): string {
 const filePath = path.join(os.tmpdir(), `wechat-post-${Date.now()}-${Math.random()}.md`);
  fs.writeFileSync(filePath, `---\n${metadata}\n---\n${content}`);
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
  const filePath = makePost('![remote](https://example.com/image.png)', 'title: Test\narticle_type: newspic');
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

test('processPostWithReport renders through the shared SDK engine while preserving the legacy theme', async () => {
  const filePath = makePost('This is a **bold** paragraph.\n\n- Item 1\n- Item 2');
  const result = await processPostWithReport(filePath, config);

  // The legacy WeChat-green styling is registered under a publisher-specific
  // name, so switching engines is invisible without replacing SDK defaults.
  expect(result.post.contentHtml).toContain('#07c160');
  expect(result.post.contentHtml).not.toContain('#0f4c81'); // SDK's own tech theme blue
  fs.unlinkSync(filePath);
});

test('processPostWithReport retains legacy styling for unsupported style names', async () => {
  const filePath = makePost('# Title');
  const result = await processPostWithReport(filePath, { ...config, style: 'custom' });

  // The old publisher only had one legacy theme even when config.style was set.
  expect(result.post.contentHtml).toContain('#07c160');
  expect(result.post.contentHtml).not.toContain('#0f4c81');
  fs.unlinkSync(filePath);
});

test('processPostWithReport does not warn about local image paths in dry-run (no uploader)', async () => {
  const downloaded = path.join(os.tmpdir(), `wechat-dryrun-${Date.now()}.png`);
  fs.writeFileSync(downloaded, 'image');
  const filePath = makePost('![remote](https://example.com/image.png)', 'title: Test\narticle_type: newspic');

  const result = await processPostWithReport(filePath, config, undefined, {
    remoteImageDownloader: { download: async () => downloaded },
  });

  // Dry-run (no uploader) intentionally leaves the local downloaded path in
  // place for preview; the SDK's resolveImage-oriented diagnostic must not
  // leak through since wechat-publisher never uses that hook.
  expect(result.post.contentMarkdown).toContain(downloaded);
  expect(result.diagnostics.some((d) => d.code === 'LOCAL_IMAGE_UNRESOLVED')).toBe(false);
  fs.unlinkSync(filePath);
  fs.unlinkSync(downloaded);
});

test('processPostWithReport still neuters external links into styled spans', async () => {
  const filePath = makePost('See [the docs](https://example.com/docs) for more.');
  const result = await processPostWithReport(filePath, config);

  expect(result.post.contentHtml).not.toContain('<a ');
  expect(result.post.contentHtml).toContain('<span style="color: #576b95; text-decoration: underline;">the docs</span>');
  fs.unlinkSync(filePath);
});

test('processPostWithReport validates a news cover before rendering or uploading assets', async () => {
  const filePath = makePost('Formula: $E=mc^2$\n\n![image](/assets/image.png)');
  let formulaCalls = 0;
  let uploadCalls = 0;

  await expect(processPostWithReport(filePath, config, {
    uploadImage: async () => {
      uploadCalls += 1;
      return 'https://mmbiz.qpic.cn/image.png';
    },
  } as any, {
    formulaRenderer: {
      getHash: () => 'formula-preflight-test',
      renderToImage: async () => {
        formulaCalls += 1;
        return path.join(os.tmpdir(), 'formula-preflight.png');
      },
    },
  })).rejects.toThrow(/thumb_media_id|cover/i);

  expect(formulaCalls).toBe(0);
  expect(uploadCalls).toBe(0);
  fs.unlinkSync(filePath);
});
