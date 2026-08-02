import http from 'http';
import fs from 'fs';
import sharp from 'sharp';
import { afterEach, expect, test } from 'vitest';
import { RemoteImageDownloader } from '../src/lib/remote-image';

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

test('RemoteImageDownloader downloads and caches image bytes by content hash', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(Buffer.from('png-content'));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');

  const downloader = new RemoteImageDownloader({ allowPrivateNetworks: true });
  const url = `http://127.0.0.1:${address.port}/image.png`;
  const first = await downloader.download(url);
  const second = await downloader.download(url);

  expect(first).toBe(second);
  expect(fs.readFileSync(first, 'utf8')).toBe('png-content');
});

test('RemoteImageDownloader rejects non-image responses', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('not an image');
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');

  await expect(new RemoteImageDownloader({ allowPrivateNetworks: true }).download(`http://127.0.0.1:${address.port}/text`))
    .rejects.toThrow(/Unsupported remote image content type/);
});

test('RemoteImageDownloader rejects loopback targets by default', async () => {
  await expect(new RemoteImageDownloader().download('http://127.0.0.1:8080/image.png'))
    .rejects.toThrow(/private or local address/);
});

test('RemoteImageDownloader does not follow redirects', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(302, { location: 'http://127.0.0.1:8080/image.png' });
    response.end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');

  await expect(new RemoteImageDownloader({ allowPrivateNetworks: true }).download(`http://127.0.0.1:${address.port}/redirect`))
    .rejects.toThrow();
});

test('RemoteImageDownloader caches converted WebP output', async () => {
  const webp = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
  }).webp().toBuffer();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'image/webp' });
    response.end(webp);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');

  const downloader = new RemoteImageDownloader({ allowPrivateNetworks: true });
  const url = 'http://127.0.0.1:' + address.port + '/image.webp';
  const first = await downloader.download(url);
  const second = await downloader.download(url);

  expect(first).toBe(second);
  expect(first).toMatch(/\.png$/);
  expect(fs.existsSync(second)).toBe(true);
});
