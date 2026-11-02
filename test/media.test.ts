import { afterEach, expect, test } from 'vitest';
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

test('BMP exports through native conversion on macOS and fails explicitly elsewhere', async () => {
  const directory = temporaryDirectory();
  const file = path.join(directory, 'pixel.bmp');
  // One white pixel, 24-bit Windows bitmap with a padded scanline.
  const bitmap = Buffer.alloc(58);
  bitmap.write('BM');
  bitmap.writeUInt32LE(58, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(1, 18);
  bitmap.writeInt32LE(1, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(4, 34);
  bitmap.fill(255, 54, 57);
  fs.writeFileSync(file, bitmap);
  if (process.platform === 'darwin') {
    expect(await readPortableImage(file)).toMatch(/^data:image\/png;base64,/);
  } else {
    await expect(readPortableImage(file)).rejects.toThrow(/BMP conversion requires macOS sips/);
  }
});
