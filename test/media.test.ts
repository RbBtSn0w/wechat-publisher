import { afterEach, expect, test, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { readPortableImage, resolveContainedFile, validateUploadableImage } from '../src/lib/media';

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-media-'));
  directories.push(directory);
  return directory;
}
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));

test('portable media verifies decoded bytes and converts SVG to PNG', async () => {
  const dir = temporaryDirectory();
  const svg = path.join(dir, 'vector.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
  const uri = await readPortableImage(svg);
  expect(uri).toMatch(/^data:image\/png;base64,/);
  expect((await sharp(Buffer.from(uri.split(',')[1], 'base64')).metadata()).format).toBe('png');
  fs.writeFileSync(path.join(dir, 'fake.png'), 'not a png');
  await expect(readPortableImage(path.join(dir, 'fake.png'))).rejects.toThrow();
});

test('canonical containment rejects traversal and external symlinks', () => {
  const dir = temporaryDirectory();
  const outside = temporaryDirectory();
  fs.writeFileSync(path.join(outside, 'secret.png'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.png'), path.join(dir, 'link.png'));
  expect(() => resolveContainedFile(dir, '../secret.png')).toThrow(/escapes/);
  expect(() => resolveContainedFile(dir, 'link.png')).toThrow(/outside/);
});

test('uploadable validation rejects corrupt, unsupported and oversized images', async () => {
  const dir = temporaryDirectory();
  const image = path.join(dir, 'image.png');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toFile(image);
  await expect(validateUploadableImage(image)).resolves.toBeUndefined();
  const webp = path.join(dir, 'image.webp');
  await sharp(image).webp().toFile(webp);
  await expect(validateUploadableImage(webp)).rejects.toThrow(/format/);
  fs.appendFileSync(image, Buffer.alloc(2 * 1024 * 1024));
  await expect(validateUploadableImage(image)).rejects.toThrow(/2.*MiB/);
});

test('content and permanent images enforce their distinct endpoint limits', async () => {
  const dir = temporaryDirectory();
  const gif = path.join(dir, 'image.gif');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).gif().toFile(gif);
  await expect(validateUploadableImage(gif, 'permanent')).resolves.toBeUndefined();
  await expect(validateUploadableImage(gif, 'content')).rejects.toThrow(/format/i);
  const png = path.join(dir, 'large.png');
  const bytes = await sharp(gif).png().toBuffer();
  fs.writeFileSync(png, Buffer.concat([bytes, Buffer.alloc(1024 * 1024 - bytes.length)]));
  await expect(validateUploadableImage(png, 'content')).rejects.toThrow(/1.*MiB/);
  await expect(validateUploadableImage(png, 'permanent')).resolves.toBeUndefined();
});

function bitmapFixture(bits: number, topDown = false): Buffer {
  const palette = bits <= 8 ? 2 : 0;
  const offset = 54 + palette * 4;
  const stride = Math.ceil(2 * bits / 32) * 4;
  const bitmap = Buffer.alloc(offset + stride);
  bitmap.write('BM');
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(offset, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(2, 18);
  bitmap.writeInt32LE(topDown ? -1 : 1, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(bits, 28);
  bitmap.writeUInt32LE(stride, 34);
  bitmap.writeUInt32LE(palette, 46);
  if (palette) {
    bitmap.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
    bitmap[offset] = bits === 1 ? 0x40 : bits === 4 ? 0x01 : 0;
    if (bits === 8) bitmap[offset + 1] = 1;
  } else if (bits === 16) {
    bitmap.writeUInt16LE(0x7c00, offset);
    bitmap.writeUInt16LE(0x001f, offset + 2);
  } else {
    bitmap.set(bits === 24 ? [0, 0, 255, 255, 0, 0] : [0, 0, 255, 0, 255, 0, 0, 0], offset);
  }
  return bitmap;
}

test.each([1, 4, 8, 16, 24, 32])('BMP %i-bit exports portable PNG with opaque red and blue pixels on Linux', async bits => {
  const file = path.join(temporaryDirectory(), 'colors.bmp');
  fs.writeFileSync(file, bitmapFixture(bits));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    const uri = await readPortableImage(file);
    expect(uri).toMatch(/^data:image\/png;base64,/);
    const png = sharp(Buffer.from(uri.split(',')[1], 'base64'));
    expect(await png.metadata()).toMatchObject({ format: 'png', width: 2, height: 1 });
    const pixels = [...await png.ensureAlpha().raw().toBuffer()];
    expect(pixels).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});

test.each([false, true])('decodes every odd-width 4-bit BMP row (topDown=%s)', async topDown => {
  const original = bitmapFixture(4);
  const bitmap = Buffer.concat([original, Buffer.alloc(4)]);
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeInt32LE(1, 18);
  bitmap.writeInt32LE(topDown ? -2 : 2, 22);
  bitmap.writeUInt32LE(8, 34);
  // The unused low nibble may refer beyond the actual two-entry palette.
  bitmap[62] = 0x0f;
  bitmap[66] = 0x1f;
  const file = path.join(temporaryDirectory(), 'odd-rows.bmp');
  fs.writeFileSync(file, bitmap);

  const uri = await readPortableImage(file);
  const png = sharp(Buffer.from(uri.split(',')[1], 'base64'));

  expect(await png.metadata()).toMatchObject({ width: 1, height: 2 });
  const red = [255, 0, 0, 255];
  const blue = [0, 0, 255, 255];
  expect([...await png.ensureAlpha().raw().toBuffer()]).toEqual(topDown ? [...red, ...blue] : [...blue, ...red]);
});

test.each([1, 4, 8])('rejects BMP %i-bit real pixels outside the declared palette', async bits => {
  const bitmap = bitmapFixture(bits);
  bitmap.writeUInt32LE(1, 46);
  const file = path.join(temporaryDirectory(), 'invalid-index.bmp');
  fs.writeFileSync(file, bitmap);

  await expect(readPortableImage(file)).rejects.toThrow(/BMP.*palette index/);
});

test.each([1, 4, 8])('ignores unused BMP %i-bit packed bits and row padding when validating indices', async bits => {
  const bitmap = bitmapFixture(bits);
  bitmap.writeInt32LE(1, 18);
  bitmap.writeUInt32LE(1, 46);
  bitmap.fill(0xff, 62);
  bitmap[62] = bits === 1 ? 0x7f : bits === 4 ? 0x0f : 0;
  const file = path.join(temporaryDirectory(), 'unused-indices.bmp');
  fs.writeFileSync(file, bitmap);

  const uri = await readPortableImage(file);

  expect([...await sharp(Buffer.from(uri.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()])
    .toEqual([255, 0, 0, 255]);
});

test('rejects an odd-width real palette index before extending the decoder palette', async () => {
  const bitmap = bitmapFixture(4);
  bitmap.writeInt32LE(1, 18);
  bitmap[62] = 0x20;
  const file = path.join(temporaryDirectory(), 'invalid-odd-index.bmp');
  fs.writeFileSync(file, bitmap);

  await expect(readPortableImage(file)).rejects.toThrow(/BMP.*palette index/);
});

test('rejects odd-width BMP when padded decoder dimensions exceed 16 MP before allocation', async () => {
  const bitmap = bitmapFixture(4);
  bitmap.writeInt32LE(1, 18);
  bitmap.writeInt32LE(8_000_001, 22);
  const file = path.join(temporaryDirectory(), 'working-limit.bmp');
  fs.writeFileSync(file, bitmap);

  await expect(readPortableImage(file)).rejects.toThrow(/BMP.*decoder dimensions.*16 MP/);
});

test.each([16, 24, 32])('preserves true-color BMP %i-bit pixels after an optional hint palette', async bits => {
  const original = bitmapFixture(bits);
  const palette = Buffer.from([12, 34, 56, 0, 78, 90, 123, 0]);
  const bitmap = Buffer.concat([original.subarray(0, 54), palette, original.subarray(54)]);
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(54 + palette.length, 10);
  bitmap.writeUInt32LE(2, 46);
  const file = path.join(temporaryDirectory(), 'hint-palette.bmp');
  fs.writeFileSync(file, bitmap);

  const uri = await readPortableImage(file);

  expect([...await sharp(Buffer.from(uri.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()])
    .toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
});

test('expands RGB555 BMP channels to full-range white, red and green', async () => {
  const bitmap = Buffer.alloc(62);
  bitmapFixture(16).copy(bitmap, 0, 0, 54);
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeInt32LE(3, 18);
  bitmap.writeUInt32LE(8, 34);
  bitmap.writeUInt16LE(0x7fff, 54);
  bitmap.writeUInt16LE(0x7c00, 56);
  bitmap.writeUInt16LE(0x03e0, 58);
  const file = path.join(temporaryDirectory(), 'rgb555.bmp');
  fs.writeFileSync(file, bitmap);

  const uri = await readPortableImage(file);

  expect([...await sharp(Buffer.from(uri.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()])
    .toEqual([255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
});

test.each([40, 52, 56, 108, 124])('accepts BMP DIB %i with a pixel offset gap and top-down rows', async dibSize => {
  const original = bitmapFixture(24, true);
  const gap = 7;
  const bitmap = Buffer.concat([original.subarray(0, 54), Buffer.alloc(dibSize - 40 + gap, 0xff), original.subarray(54)]);
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeUInt32LE(dibSize, 14);
  bitmap.writeUInt32LE(14 + dibSize + gap, 10);
  const file = path.join(temporaryDirectory(), 'extended.bmp');
  fs.writeFileSync(file, bitmap);

  const uri = await readPortableImage(file);

  expect([...await sharp(Buffer.from(uri.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()])
    .toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
});

test.each([false, true])('preserves BMP row orientation (topDown=%s)', async topDown => {
  const bitmap = Buffer.concat([bitmapFixture(24, topDown), Buffer.from([0, 255, 0, 255, 255, 255, 0, 0])]);
  bitmap.writeUInt32LE(bitmap.length, 2);
  bitmap.writeInt32LE(topDown ? -2 : 2, 22);
  bitmap.writeUInt32LE(16, 34);
  const file = path.join(temporaryDirectory(), 'rows.bmp');
  fs.writeFileSync(file, bitmap);

  const uri = await readPortableImage(file);

  const first = [255, 0, 0, 255, 0, 0, 255, 255];
  const second = [0, 255, 0, 255, 255, 255, 255, 255];
  expect([...await sharp(Buffer.from(uri.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer()])
    .toEqual(topDown ? [...first, ...second] : [...second, ...first]);
});

test.each([
  ['short header', (b: Buffer) => b.subarray(0, 30)],
  ['wrong signature', (b: Buffer) => { b.write('ZZ'); return b; }],
  ['unsupported DIB', (b: Buffer) => { b.writeUInt32LE(12, 14); return b; }],
  ['truncated DIB', (b: Buffer) => { b.writeUInt32LE(124, 14); return b; }],
  ['negative width', (b: Buffer) => { b.writeInt32LE(-2, 18); return b; }],
  ['zero height', (b: Buffer) => { b.writeInt32LE(0, 22); return b; }],
  ['oversized dimensions', (b: Buffer) => { b.writeInt32LE(50000, 18); b.writeInt32LE(50000, 22); return b; }],
  ['invalid planes', (b: Buffer) => { b.writeUInt16LE(2, 26); return b; }],
  ['unsupported bits', (b: Buffer) => { b.writeUInt16LE(2, 28); return b; }],
  ['compressed encoding', (b: Buffer) => { b.writeUInt32LE(1, 30); return b; }],
  ['pixel offset inside header', (b: Buffer) => { b.writeUInt32LE(10, 10); return b; }],
  ['truncated pixels', (b: Buffer) => b.subarray(0, b.length - 1)],
  ['oversized palette', (b: Buffer) => { b.writeUInt16LE(8, 28); b.writeUInt32LE(0xffffffff, 46); return b; }],
  ['palette exceeds bit depth', (b: Buffer) => { b.writeUInt16LE(1, 28); b.writeUInt32LE(3, 46); return b; }],
  ['palette overlaps pixels', (b: Buffer) => { b.writeUInt16LE(8, 28); b.writeUInt32LE(2, 46); return b; }],
] as const)('rejects BMP %s before decoding', async (_name, corrupt) => {
  const file = path.join(temporaryDirectory(), 'invalid.bmp');
  fs.writeFileSync(file, corrupt(bitmapFixture(24)));
  await expect(readPortableImage(file)).rejects.toThrow(/BMP/i);
});

test('rejects BMP input above 64 MiB before reading the body', async () => {
  const file = path.join(temporaryDirectory(), 'large.bmp');
  fs.writeFileSync(file, 'BM');
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const read = vi.spyOn(fs, 'readFileSync');
  try {
    await expect(readPortableImage(file)).rejects.toThrow(/BMP.*64 MiB/);
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});
