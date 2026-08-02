import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { expect, test, vi } from 'vitest';
import { syncCommand } from '../src/commands/sync';
import { latestCommand } from '../src/commands/latest';

test('sync-flow placeholder', () => {
  // Full integration test requires mock server, placeholder for now
  expect(true).toBe(true);
});

test('sync dry-run does not require WeChat credentials or API calls', async () => {
  const filePath = path.join(os.tmpdir(), `wechat-sync-${Date.now()}.md`);
  fs.writeFileSync(filePath, '---\ntitle: Dry Run\n---\n# Body');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await expect(syncCommand(filePath, { dryRun: true, config: 'missing.yml' })).resolves.toBeUndefined();
  fs.unlinkSync(filePath);
  vi.restoreAllMocks();
});

test('sync creates a draft through the mock WeChat API with local cover and body image', async () => {
  let draftAdds = 0;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url?.startsWith('/cgi-bin/token')) {
      response.end(JSON.stringify({ access_token: 'token', expires_in: 3600 }));
    } else if (request.url?.startsWith('/cgi-bin/media/uploadimg')) {
      response.end(JSON.stringify({ url: 'https://mmbiz.qpic.cn/body.png' }));
    } else if (request.url?.startsWith('/cgi-bin/material/add_material')) {
      response.end(JSON.stringify({ media_id: 'cover-media' }));
    } else if (request.url?.startsWith('/cgi-bin/draft/batchget')) {
      response.end(JSON.stringify({ item: [] }));
    } else if (request.url?.startsWith('/cgi-bin/draft/add')) {
      draftAdds += 1;
      response.end(JSON.stringify({ media_id: 'draft-media' }));
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ errcode: 404, errmsg: 'not found' }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-sync-real-'));
  const postPath = path.join(root, 'post.md');
  const coverPath = path.join(root, 'cover.png');
  const bodyPath = path.join(root, 'body.png');
  const configPath = path.join(root, 'wechat.yml');
  fs.writeFileSync(coverPath, 'cover');
  fs.writeFileSync(bodyPath, 'body');
  fs.writeFileSync(postPath, [
    '---',
    'title: Mock API article',
    `image:`,
    `  path: ${coverPath}`,
    '---',
    `![body](${bodyPath})`,
  ].join('\n'));
  fs.writeFileSync(configPath, [
    'appId: app',
    'appSecret: secret',
    `baseUrl: http://127.0.0.1:${address.port}`,
    `assetsDir: ${root}`,
    'postsDir: .',
    'style: tech',
  ].join('\n'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await expect(syncCommand(postPath, { config: configPath, force: true })).resolves.toBeUndefined();
  expect(draftAdds).toBe(1);
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

test('latest continues after an unsupported post and reports a non-zero batch result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-latest-'));
  const postsDir = path.join(root, '_posts');
  fs.mkdirSync(postsDir);
  fs.writeFileSync(path.join(postsDir, '2026-02-bad.md'), '---\ntitle: Bad\n---\nText[^1]\n\n[^1]: note');
  fs.writeFileSync(path.join(postsDir, '2026-01-good.md'), '---\ntitle: Good\n---\n# Good');
  fs.writeFileSync(path.join(root, 'wechat.yml'), 'postsDir: _posts\nassetsDir: assets\n');
  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  await latestCommand('2', { dryRun: true, config: 'wechat.yml' });

  expect(process.exitCode).toBe(1);
  process.exitCode = previousExitCode;
  cwdSpy.mockRestore();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
