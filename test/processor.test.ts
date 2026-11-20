import { validPng } from './helpers/image';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';
import { processPostWithReport } from '../src/lib/processor';
import { MermaidRenderer } from '../src/lib/mermaid-renderer';
import { LEGACY_THEME_NAME, resolvePublisherTheme } from '../src/lib/theme-registry';

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
  fs.writeFileSync(formulaImage, validPng);
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
  fs.writeFileSync(downloaded, validPng);
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

test('processPostWithReport accepts the default empty optional site URL with SDK v2', async () => {
  const filePath = makePost('Body text.', 'title: Empty Site URL\narticle_type: newspic');
  try {
    const result = await processPostWithReport(filePath, { ...config, siteUrl: '' });
    expect(result.post.contentHtml).toContain('Body text.');
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('processPostWithReport does not warn about local image paths in dry-run (no uploader)', async () => {
  const downloaded = path.join(os.tmpdir(), `wechat-dryrun-${Date.now()}.png`);
  fs.writeFileSync(downloaded, validPng);
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

test('processPostWithReport renders code blocks with macCodeBlock decoration and white-space: pre', async () => {
  const filePath = makePost('```typescript\nconst message = "hello";\nconsole.log(message);\n```', 'title: Code Test\narticle_type: newspic');
  const result = await processPostWithReport(filePath, config);

  expect(result.post.contentHtml).toContain('TYPESCRIPT');
  expect(result.post.contentHtml).toContain('white-space: pre');
  expect(result.post.contentHtml).toContain('overflow-x: auto');
  expect(result.post.contentHtml).toContain('word-break: normal');
  fs.unlinkSync(filePath);
});

test('processPostWithReport keeps spaces between highlighted code tokens', async () => {
  const filePath = makePost(
    [
      '```swift',
      'class CanvasNodeView: UIView {',
      '    func refreshBorder() {}',
      '    if UIDevice.current.orientation.isLandscape {}',
      '}',
      '```',
    ].join('\n'),
    'title: Code Spacing\narticle_type: newspic',
  );
  const result = await processPostWithReport(filePath, config);
  const html = result.post.contentHtml;

  expect(html).toMatch(/class<\/span>(?:&nbsp;|\u00a0)<span/);
  expect(html).toMatch(/func<\/span>(?:&nbsp;|\u00a0)<span/);
  expect(html).toMatch(/if<\/span>(?:&nbsp;|\u00a0)<span/);
  expect(html).not.toMatch(/<\/span> <span/);
  expect(html).toContain('white-space: pre');
  fs.unlinkSync(filePath);
});

test('processPostWithReport supports the restrained apple theme without legacy green/magenta accents', async () => {
  const filePath = makePost('## Section\n\nUse `traitCollection` with **bold** emphasis.\n\n```swift\nlet x = 1\n```\n\n---', 'title: Apple Theme\narticle_type: newspic');
  const result = await processPostWithReport(filePath, { ...config, style: 'apple' });
  const html = result.post.contentHtml;

  expect(html).not.toContain('#07c160');
  expect(html).not.toContain('#e91e63');
  expect(html).not.toContain('#1e1f22');
  expect(html).toContain('#282c34');
  expect(html).toContain('#1d1d1f');
  expect(html).toContain('#f2f2f7');
  expect(html).toContain('text-align: left');
  fs.unlinkSync(filePath);
});

test('processPostWithReport routes opted-in SDK theme names such as modern-tech', async () => {
  const filePath = makePost('A **bold** statement.', 'title: Modern Tech\narticle_type: newspic');
  const result = await processPostWithReport(filePath, { ...config, style: 'modern-tech' });

  expect(result.post.contentHtml).toContain('#0f4c81');
  expect(result.post.contentHtml).not.toContain('#07c160');
  fs.unlinkSync(filePath);
});

test('processPostWithReport appends link footnotes when config.footnotes is enabled', async () => {
  const filePath = makePost('Read [Apple TN3192](https://developer.apple.com/documentation/technotes/tn3192) and [Local Post](/posts/demo/).', 'title: Footnotes\narticle_type: newspic');
  const result = await processPostWithReport(filePath, { ...config, siteUrl: 'https://example.com', footnotes: true });
  const html = result.post.contentHtml;

  expect(html).toContain('[1]</sup>');
  expect(html).toContain('参考链接');
  expect(html).toContain('https://developer.apple.com/documentation/technotes/tn3192');
  expect(html).toContain('https://example.com/posts/demo/');
  fs.unlinkSync(filePath);
});

test('processPostWithReport omits default English Mermaid caption and respects explicit caption comment', async () => {
  const mermaidImg = path.join(os.tmpdir(), `wechat-mermaid-${Date.now()}.png`);
  fs.writeFileSync(mermaidImg, validPng);
  const filePath = makePost([
    '```mermaid',
    'flowchart LR',
    'A --> B',
    '```',
    '',
    '```mermaid',
    '%% caption: 跨进程恢复时序 [v2]',
    'flowchart LR',
    'C --> D',
    '```',
  ].join('\n'), 'title: Mermaid Captions\narticle_type: newspic');

  const result = await processPostWithReport(filePath, config, undefined, {
    mermaidRenderer: {
      getHash: () => 'mermaid-caption-test',
      renderToImage: async () => mermaidImg,
    },
  });

  expect(result.post.contentHtml).not.toContain('Mermaid Diagram');
  expect(result.post.contentHtml).toContain('跨进程恢复时序 [v2]');
  expect(result.post.contentHtml).toContain('<img');
  fs.unlinkSync(filePath);
  fs.unlinkSync(mermaidImg);
});

test('processPostWithReport warns when trivial numbers or units are wrapped in inline math delimiters', async () => {
  const formulaImage = path.join(os.tmpdir(), `wechat-trivial-math-${Date.now()}.png`);
  fs.writeFileSync(formulaImage, validPng);
  const filePath = makePost('Display: $4K$ and equation: $E = mc^2$', 'title: Math Warning\narticle_type: newspic');
  const result = await processPostWithReport(filePath, config, undefined, {
    formulaRenderer: {
      getHash: (expr) => expr,
      renderToImage: async () => formulaImage,
    },
  });

  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: 'TRIVIAL_INLINE_MATH', severity: 'warning', resource: '$4K$' }),
  ]);
  fs.unlinkSync(filePath);
  fs.unlinkSync(formulaImage);
});

test('MermaidRenderer injects neutral theme by default and preserves explicit directives', () => {
  const renderer = new MermaidRenderer();
  expect(renderer.applyDefaultTheme('flowchart LR\nA --> B')).toMatch(/^%%\{init: \{'theme': 'neutral'\}\}%%\nflowchart LR/);

  const customInit = "%%{init: {'theme': 'forest'}}%%\nflowchart LR\nA --> B";
  expect(renderer.applyDefaultTheme(customInit)).toBe(customInit);

  const customInitialize = "%%{initialize: {'fontFamily': 'monospace'}}%%\nflowchart LR\nA --> B";
  expect(renderer.applyDefaultTheme(customInitialize)).toBe(customInitialize);

  const frontmatter = '---\ntitle: Demo\n---\nflowchart LR\nA --> B';
  expect(renderer.applyDefaultTheme(frontmatter)).toBe(frontmatter);
});

test('processPostWithReport ignores empty Mermaid captions and preserves captions with trailing backslashes', async () => {
  const mermaidImg = path.join(os.tmpdir(), `wechat-mermaid-edge-${Date.now()}.png`);
  fs.writeFileSync(mermaidImg, validPng);
  const filePath = makePost([
    '```mermaid',
    '%% caption:',
    'flowchart LR',
    'A --> B',
    '```',
    '',
    '```mermaid',
    '%% caption:   ',
    'flowchart LR',
    'C --> D',
    '```',
    '',
    '```mermaid',
    '%% caption: Path C:\\temp\\',
    'flowchart LR',
    'E --> F',
    '```',
  ].join('\n'), 'title: Mermaid Caption Edge Cases\narticle_type: newspic');

  try {
    const result = await processPostWithReport(filePath, config, undefined, {
      mermaidRenderer: {
        getHash: () => 'mermaid-caption-edge-test',
        renderToImage: async () => mermaidImg,
      },
    });

    const html = result.post.contentHtml;
    expect(html).not.toContain('alt="flowchart LR"');
    expect(html).not.toContain('>flowchart LR<');
    expect(html).toContain('<img');
    expect(html).toContain('Path C:\\temp\\');
  } finally {
    fs.unlinkSync(filePath);
    fs.unlinkSync(mermaidImg);
  }
});

test('resolvePublisherTheme rejects inherited Object.prototype keys and falls back to legacy styling', async () => {
  for (const protoKey of ['constructor', '__proto__', 'toString']) {
    expect(resolvePublisherTheme(protoKey)).toBe(LEGACY_THEME_NAME);
  }

  const filePath = makePost('Inherited key **test**.', 'title: Prototype Guard\narticle_type: newspic');
  try {
    const result = await processPostWithReport(filePath, { ...config, style: 'constructor' });
    expect(result.post.contentHtml).toContain('#07c160');
    expect(result.post.contentHtml).not.toContain('#0f4c81');
  } finally {
    fs.unlinkSync(filePath);
  }
});
