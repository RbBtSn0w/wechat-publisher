import http from 'http';
import { afterEach, expect, test } from 'vitest';
import { WeChatAPIClient } from '../src/lib/api-client';

const servers: http.Server[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });
async function clientFor(handler: http.RequestListener, timeout = 2_000) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return new WeChatAPIClient({ appId: 'app', appSecret: 'secret-value', baseUrl: `http://127.0.0.1:${address.port}`, postsDir: '_posts', assetsDir: 'assets', maxRetries: 1, requestTimeoutMs: timeout });
}
function token(request: http.IncomingMessage, response: http.ServerResponse) {
  if (!request.url?.startsWith('/cgi-bin/token')) return false;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ access_token: 'token-value', expires_in: 3600 }));
  return true;
}

test('safe token and draft reads retry transient responses', async () => {
  let tokenCalls = 0;
  let reads = 0;
  const client = await clientFor((request, response) => {
    if (request.url?.startsWith('/cgi-bin/token')) {
      if (++tokenCalls === 1) { response.writeHead(503); response.end(); return; }
      token(request, response); return;
    }
    if (++reads === 1) { response.writeHead(503); response.end(); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ item: [{ media_id: 'one' }] }));
  });
  await expect(client.getAllDrafts()).resolves.toEqual([{ media_id: 'one' }]);
  expect(tokenCalls).toBe(2);
  expect(reads).toBe(2);
});

for (const failure of ['disconnect', '503', '408', 'malformed', 'timeout']) {
  test(`draft add attempts once when the server committed but returned ${failure}`, async () => {
    let committed = 0;
    const client = await clientFor((request, response) => {
      if (token(request, response)) return;
      committed++;
      if (failure === 'disconnect') { request.socket.destroy(); return; }
      if (failure === 'timeout') return;
      response.writeHead(failure === '503' ? 503 : failure === '408' ? 408 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ errmsg: 'secret-value token-value' }));
    }, failure === 'timeout' ? 1_000 : 2_000);
    const error = await client.addDraft([]).catch(error => error);
    expect(error).toMatchObject({ code: 'WRITE_RESULT_UNKNOWN' });
    expect(String(error)).not.toMatch(/secret-value|token-value/);
    expect(committed).toBe(1);
  });
}

test('update and multipart never retry and business errors are distinct', async () => {
  let calls = 0;
  const client = await clientFor((request, response) => {
    if (token(request, response)) return;
    calls++;
    response.writeHead(503); response.end();
  });
  await expect(client.updateDraft('id', 0, {})).rejects.toMatchObject({ code: 'WRITE_RESULT_UNKNOWN' });
  await expect(client.postMultipart('/upload', () => ({ body: 'x', headers: {} }), {})).rejects.toMatchObject({ code: 'WRITE_RESULT_UNKNOWN' });
  expect(calls).toBe(2);
  const rejected = await clientFor((request, response) => {
    if (token(request, response)) return;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ errcode: 40001, errmsg: 'secret-value token-value' }));
  });
  await expect(rejected.addDraft([])).rejects.toMatchObject({ code: 'WECHAT_REJECTED', errcode: 40001 });
});

test('token success must contain a valid token and lifetime', async () => {
  const client = await clientFor((_request, response) => { response.end('{}'); });
  await expect(client.getAccessToken()).rejects.toThrow(/Invalid token response/);
});
