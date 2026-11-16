const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const [packageRoot, fixtures] = process.argv.slice(2);
const publisher = require(packageRoot);
const cli = path.join(packageRoot, 'dist', 'bin', 'wechat-pub.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=', 'base64');
fs.mkdirSync(fixtures);
fs.writeFileSync(path.join(fixtures, 'image.png'), png);

const body = [
  '# Installed package',
  '',
  '**Package bold**',
  '',
  '[Official article](https://mp.weixin.qq.com/s/package-smoke)',
  '',
  '[External reference](https://example.test/reference)',
  '',
  '```typescript',
  'console.log("<script>hello world</script>");',
  '```',
].join('\n');
const markdown = body + '\n\n![Portable image](local://image.png)';
const source = path.join(fixtures, 'post.md');
const output = path.join(fixtures, 'export.html');
fs.writeFileSync(source, '---\ntitle: Installed package\narticle_type: newspic\n---\n' + markdown);

function verifyRendered(html) {
  assert.match(html, /<strong\b[^>]*>Package bold<\/strong>/);
  assert.match(html, /<pre\b[\s\S]*<code\b/);
  assert.match(html, /white-space:\s*pre/);
  const code = html.match(/<pre\b[\s\S]*?<\/pre>/)?.[0];
  assert.ok(code, 'Rendered output has no code block');
  assert.match(code, /<span\b[^>]*style="[^"]*color:/);
  assert.match(html, /&lt;script&gt;hello world&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script\b/);
}

(async () => {
  const formulaDirectory = path.join(fixtures, 'formulas');
  const rendered = await publisher.renderMarkdownToWechat(body + '\n\n$\\frac{13}{29}$', {
    renderMermaid: false, footnoteLinks: false, macCodeBlock: true,
    services: { formulaRenderer: new publisher.FormulaRenderer(formulaDirectory) },
  });
  verifyRendered(rendered.html);
  assert.equal(rendered.stats.formulas, 1);
  const formula = rendered.images.find(image => image.startsWith(formulaDirectory));
  assert.ok(formula, 'Packed SDK did not return its generated formula');
  assert.ok(fs.readFileSync(formula).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));

  const processed = await publisher.processPostWithReport(source, {
    appId: '', appSecret: '', postsDir: '_posts', assetsDir: fixtures, style: 'tech', siteUrl: '',
  });
  verifyRendered(processed.post.contentHtml);
  assert.ok(processed.post.contentHtml.includes('#07c160'), 'Legacy publisher theme was lost');
  assert.ok(!processed.post.contentHtml.includes('wechat-publisher.invalid/resource/'));

  execFileSync(process.execPath, [cli, 'export', source, '--output', output, '--strict'], { stdio: 'inherit' });
  const html = fs.readFileSync(output, 'utf8');
  verifyRendered(html);
  assert.match(html, /<a\b[^>]*href="https:\/\/mp\.weixin\.qq\.com\/s\/package-smoke"/);
  assert.doesNotMatch(html, /<a\b[^>]*href="https:\/\/example\.test/);
  assert.ok(html.includes('External reference'));
  const embedded = html.match(/src="data:image\/png;base64,([^"]+)"/);
  assert.ok(embedded, 'Installed export did not inline local media');
  assert.ok(Buffer.from(embedded[1], 'base64').equals(png), 'Exported image bytes differ');
  assert.ok(!html.includes('src="local://'));

  fs.writeFileSync(source, '![Missing image](local://missing.png)');
  const rejectedOutput = path.join(fixtures, 'rejected.html');
  const rejected = spawnSync(process.execPath, [cli, 'export', source, '--output', rejectedOutput, '--strict'], { encoding: 'utf8' });
  assert.equal(rejected.status, 1, 'Missing media must fail the installed CLI');
  assert.match(rejected.stderr, /not found|ENOENT|missing/i);
  assert.ok(!fs.existsSync(rejectedOutput), 'Rejected export wrote a partial file');
  console.log('Installed functionality passed: SDK rendering/formulas, publisher processing, CLI export, portable media and missing-media rejection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
