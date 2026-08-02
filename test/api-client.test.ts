import http from 'http';
import { afterEach, expect, test } from 'vitest';
import { WeChatAPIClient } from '../src/lib/api-client';

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

test('WeChatAPIClient retries transient failures and paginates drafts', async () => {
  let tokenCalls = 0;
  let addCalls = 0;
  let multipartCalls = 0;
  const noContentValues: number[] = [];
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/cgi-bin/token')) {
      tokenCalls += 1;
      if (tokenCalls === 1) {
        response.writeHead(503);
        response.end('temporary');
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ access_token: 'token', expires_in: 3600 }));
      return;
    }
    if (request.url?.startsWith('/cgi-bin/draft/add')) {
      addCalls += 1;
      if (addCalls === 1) {
        response.writeHead(503);
        response.end('temporary');
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ media_id: 'new-media' }));
      return;
    }
    if (request.url?.startsWith('/multipart')) {
      multipartCalls += 1;
      if (multipartCalls === 1) {
        response.writeHead(503);
        response.end('temporary');
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url?.startsWith('/cgi-bin/draft/batchget')) {
      const body = await new Promise<string>(resolve => {
        let chunks = '';
        request.on('data', chunk => { chunks += chunk; });
        request.on('end', () => resolve(chunks));
      });
      const offset = JSON.parse(body).offset;
      noContentValues.push(JSON.parse(body).no_content);
      response.setHeader('content-type', 'application/json');
      const item = offset === 0
        ? Array.from({ length: 20 }, (_, index) => ({ media_id: `m-${index}` }))
        : [{ media_id: 'm-20' }];
      response.end(JSON.stringify({ item }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');

  const client = new WeChatAPIClient({
    appId: 'app',
    appSecret: 'secret',
    baseUrl: `http://127.0.0.1:${address.port}`,
    postsDir: '_posts',
    assetsDir: 'assets',
    maxRetries: 1,
    requestTimeoutMs: 2_000,
  });

  await expect(client.addDraft([{ title: 'Title' }])).resolves.toBe('new-media');
  await expect(client.getAllDrafts()).resolves.toHaveLength(21);
  await expect(client.getDrafts(0, 1)).resolves.toHaveLength(20);
  let factoryCalls = 0;
  await expect(client.postMultipart('/multipart', () => {
    factoryCalls += 1;
    return { body: `body-${factoryCalls}`, headers: { 'x-test': 'yes' } };
  }, {})).resolves.toMatchObject({ data: { ok: true } });
  expect(tokenCalls).toBe(2);
  expect(addCalls).toBe(2);
  expect(factoryCalls).toBe(2);
  expect(noContentValues).toEqual([0, 0, 1]);
});
