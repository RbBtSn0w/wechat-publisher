import fs from 'fs';
import path from 'path';
import { decode as decodeBmp } from 'bmp-ts';
import sharp from 'sharp';

function isContained(baseDir: string, candidate: string): boolean {
  const relative = path.relative(baseDir, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Check both lexical traversal and canonical containment before reading media. */
export function resolveContainedFile(baseDir: string, relativePath: string): string {
  const base = path.resolve(baseDir);
  const candidate = path.resolve(base, relativePath);
  if (!isContained(base, candidate)) throw new Error(`Local placeholder path escapes directory: ${relativePath}`);
  const canonicalBase = fs.realpathSync(base);
  const canonicalFile = fs.realpathSync(candidate);
  if (!isContained(canonicalBase, canonicalFile)) throw new Error(`Local placeholder targets file outside directory: ${relativePath}`);
  if (!fs.statSync(canonicalFile).isFile()) throw new Error(`Media path is not a regular file: ${relativePath}`);
  return canonicalFile;
}

const portableMime: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

const MAX_BMP_BYTES = 64 * 1024 * 1024;
const MAX_BMP_PIXELS = 16_000_000;

async function convertBmpToPng(bytes: Buffer): Promise<Buffer> {
  const invalid = (reason: string): never => { throw new Error(`Unsupported or invalid BMP: ${reason}`); };
  if (bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM') invalid('missing Windows bitmap header');
  const dibSize = bytes.readUInt32LE(14);
  if (![40, 52, 56, 108, 124].includes(dibSize) || 14 + dibSize > bytes.length) invalid('unsupported or truncated DIB header');
  const width = bytes.readInt32LE(18);
  const signedHeight = bytes.readInt32LE(22);
  const height = Math.abs(signedHeight);
  if (width <= 0 || height === 0 || width * height > MAX_BMP_PIXELS) invalid('dimensions exceed the 16 MP limit or are invalid');
  const bits = bytes.readUInt16LE(28);
  if (bytes.readUInt16LE(26) !== 1 || ![1, 4, 8, 16, 24, 32].includes(bits)) invalid('unsupported planes or bit depth');
  const decoderWidth = bits === 4 && width % 2 !== 0 ? width + 1 : width;
  if (decoderWidth * height > MAX_BMP_PIXELS) invalid('decoder dimensions exceed the 16 MP limit');
  if (bytes.readUInt32LE(30) !== 0) invalid('only uncompressed BI_RGB encoding is supported');
  const colors = bytes.readUInt32LE(46);
  if (colors > 256 || (bits <= 8 && colors > 2 ** bits)) invalid('palette count exceeds the bit depth or 256 entries');
  const paletteCount = bits <= 8 ? colors || 2 ** bits : colors;
  const paletteBytes = paletteCount * 4;
  const headerEnd = 14 + dibSize;
  const pixelOffset = bytes.readUInt32LE(10);
  if (pixelOffset < headerEnd + paletteBytes || pixelOffset > bytes.length) invalid('palette or pixel offset is out of bounds');
  const stride = Math.ceil(width * bits / 32) * 4;
  const pixelBytes = stride * height;
  if (pixelBytes > bytes.length - pixelOffset) invalid('truncated pixel scanlines');

  if (bits <= 8) {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const bitOffset = column * bits;
        const packed = bytes[pixelOffset + row * stride + Math.floor(bitOffset / 8)];
        const paletteIndex = (packed >> (8 - bits - bitOffset % 8)) & (2 ** bits - 1);
        if (paletteIndex >= paletteCount) invalid('pixel palette index exceeds the declared palette');
      }
    }
  }

  // bmp-ts reads pixels immediately after the palette and applies extended-header masks.
  // Normalize the admitted BI_RGB container; the dependency still owns all pixel decoding.
  // Odd-width 4-bit decoding stops early upstream. A virtual trailing pixel keeps
  // scanline strides unchanged; fill unused palette slots, then crop that pixel with Sharp.
  const decoderPaletteCount = decoderWidth !== width ? 16 : paletteCount;
  const normalized = Buffer.concat([
    bytes.subarray(0, 54),
    bytes.subarray(headerEnd, headerEnd + paletteBytes),
    Buffer.alloc((decoderPaletteCount - paletteCount) * 4),
    bytes.subarray(pixelOffset, pixelOffset + pixelBytes),
  ]);
  normalized.writeUInt32LE(normalized.length, 2);
  normalized.writeUInt32LE(54 + decoderPaletteCount * 4, 10);
  normalized.writeUInt32LE(40, 14);
  normalized.writeInt32LE(decoderWidth, 18);
  normalized.writeUInt32LE(decoderPaletteCount, 46);
  const decoded = decodeBmp(normalized);
  const rgba = decoded.data;
  // The decoder defaults to ABGR. BI_RGB alpha is reserved, so export opaque pixels.
  // Its RGB555 channels stop at 248; normalize those five-bit values to full range.
  const channelScale = bits === 16 ? 255 / 248 : 1;
  for (let index = 0; index < rgba.length; index += 4) {
    const red = rgba[index + 3];
    const green = rgba[index + 2];
    const blue = rgba[index + 1];
    rgba[index] = Math.round(red * channelScale);
    rgba[index + 1] = Math.round(green * channelScale);
    rgba[index + 2] = Math.round(blue * channelScale);
    rgba[index + 3] = 255;
  }
  return sharp(rgba, { raw: { width: decoderWidth, height, channels: 4 } })
    .extract({ left: 0, top: 0, width, height }).png().toBuffer();
}

export async function readPortableImage(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(extension)) {
    throw new Error(`Unsupported image format "${extension}" for local image "${filePath}".`);
  }
  if (fs.statSync(filePath).size > MAX_BMP_BYTES) {
    throw new Error(`${extension === '.bmp' ? 'BMP' : 'Image'} input exceeds the 64 MiB limit`);
  }
  let bytes: Buffer = fs.readFileSync(filePath);
  if (extension === '.bmp') {
    if (bytes.length > MAX_BMP_BYTES) throw new Error(`${extension === '.bmp' ? 'BMP' : 'Image'} input exceeds the 64 MiB limit`);
    bytes = await convertBmpToPng(bytes);
  }
  const image = sharp(bytes, { animated: true, failOn: 'warning' });
  const metadata = await image.metadata();
  const format = metadata.format || '';
  if (format === 'svg') {
    bytes = await image.png().toBuffer();
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }
  const mime = portableMime[format];
  if (!mime) throw new Error(`Unsupported decoded image format "${format}" in ${filePath}`);
  // metadata() only reads headers; force a complete pixel decode before exporting original bytes.
  await image.raw().toBuffer();
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** Validate original upload bytes; callers retain control over upload ordering. */
export async function readValidatedUploadImage(filePath: string, kind: 'content' | 'permanent' = 'permanent', snapshot?: Buffer): Promise<Buffer> {
  const formats = kind === 'content' ? ['jpeg', 'png'] : ['jpeg', 'png', 'gif'];
  const extensions = kind === 'content' ? ['.jpg', '.jpeg', '.png'] : ['.jpg', '.jpeg', '.png', '.gif'];
  if (!extensions.includes(path.extname(filePath).toLowerCase())) {
    throw new Error(`Unsupported image format: ${path.extname(filePath)}`);
  }
  const maxBytes = (kind === 'content' ? 1 : 2) * 1024 * 1024;
  let bytes = snapshot;
  if (!bytes) {
    // Bind the upload to one descriptor; never follow a replaced final symlink.
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || (kind === 'content' ? stat.size >= maxBytes : stat.size > maxBytes)) {
        throw new Error(`Image exceeds ${maxBytes / 1024 / 1024} MiB ${kind} upload limit: ${filePath}`);
      }
      bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) throw new Error('Image changed while reading; run preflight again.');
        offset += count;
      }
      if (fs.fstatSync(fd).size !== stat.size) throw new Error('Image changed while reading; run preflight again.');
    } finally { fs.closeSync(fd); }
  }
  if (kind === 'content' ? bytes.length >= maxBytes : bytes.length > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes / 1024 / 1024} MiB ${kind} upload limit: ${filePath}`);
  }
  const image = sharp(bytes, { animated: true, failOn: 'warning' });
  const metadata = await image.metadata();
  if (!formats.includes(metadata.format || '')) throw new Error(`Unsupported ${kind} upload image format: ${metadata.format || 'unknown'} (${filePath})`);
  await image.raw().toBuffer();
  return bytes;
}

/** Validate a path without changing the existing validator return contract. */
export async function validateUploadableImage(filePath: string, kind: 'content' | 'permanent' = 'permanent'): Promise<void> {
  await readValidatedUploadImage(filePath, kind);
}
