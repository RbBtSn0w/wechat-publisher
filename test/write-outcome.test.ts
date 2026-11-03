import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';
import { Uploader } from '../src/lib/uploader';
import { WeChatAPIClient } from '../src/lib/api-client';
import { validPng } from './helpers/image';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function uploader(data: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-upload-test-'));
  roots.push(root);
  const file = path.join(root, 'image.png');
  fs.writeFileSync(file, validPng);
  const api = { getAccessToken: vi.fn(async () => 'token'), postMultipart: vi.fn(async () => ({ data })) };
  return { instance: new Uploader(api as unknown as WeChatAPIClient), file, api };
}

for (const data of [{}, { url: '' }, { url: 'javascript:secret-value' }, { url: 'not a url' }]) {
  test(`image success response requires a usable URL: ${JSON.stringify(data)}`, async () => {
    const { instance, file } = uploader(data);
    await expect(instance.uploadImage(file)).rejects.toMatchObject({ code: 'WRITE_RESULT_UNKNOWN' });
  });
}

test('permanent uploads require a nonempty media id', async () => {
  const { instance, file } = uploader({ media_id: '' });
  await expect(instance.uploadPermanentImage(file)).rejects.toMatchObject({ code: 'WRITE_RESULT_UNKNOWN' });
});

test('business rejects never disclose remote messages', async () => {
  const { instance, file } = uploader({ errcode: 40001, errmsg: 'secret-value' });
  const error = await instance.uploadImage(file).catch(error => error);
  expect(error).toMatchObject({ code: 'WECHAT_REJECTED', errcode: 40001 });
  expect(String(error)).not.toContain('secret-value');
});

test('validated image and permanent media successes retain their results', async () => {
  const { instance, file } = uploader({ url: 'https://wechat/image', media_id: 'media' });
  await expect(instance.uploadImage(file)).resolves.toBe('https://wechat/image');
  await expect(instance.uploadPermanentImage(file)).resolves.toBe('media');
});

test('direct content uploads enforce the endpoint byte limit before token acquisition', async () => {
  const { instance, file, api } = uploader({ url: 'https://wechat/image' });
  fs.appendFileSync(file, Buffer.alloc(1024 * 1024 - fs.statSync(file).size));
  await expect(instance.uploadImage(file)).rejects.toThrow(/1.*MiB/);
  expect(api.getAccessToken).not.toHaveBeenCalled();
  expect(api.postMultipart).not.toHaveBeenCalled();
});
