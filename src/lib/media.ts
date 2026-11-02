import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
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

export async function readPortableImage(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(extension)) {
    throw new Error(`Unsupported image format "${extension}" for local image "${filePath}".`);
  }
  let bytes = fs.readFileSync(filePath);
  // Bundled libvips lacks BMP decoding. macOS ImageIO supplies the existing native fallback.
  if (extension === '.bmp' && bytes.subarray(0, 2).toString('ascii') === 'BM') {
    if (process.platform !== 'darwin') throw new Error('BMP conversion requires macOS sips on this installation.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-media-'));
    try {
      const output = path.join(directory, 'image.png');
      await promisify(execFile)('/usr/bin/sips', ['-s', 'format', 'png', filePath, '--out', output]);
      bytes = fs.readFileSync(output);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
export async function validateUploadableImage(filePath: string): Promise<void> {
  if (!['.jpg', '.jpeg', '.png', '.gif'].includes(path.extname(filePath).toLowerCase())) {
    throw new Error(`Unsupported image format: ${path.extname(filePath)}`);
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > 2 * 1024 * 1024) throw new Error(`Image exceeds 2 MiB upload limit: ${filePath}`);
  const image = sharp(bytes, { animated: true, failOn: 'warning' });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'gif'].includes(metadata.format || '')) throw new Error(`Unsupported upload image format: ${metadata.format || 'unknown'} (${filePath})`);
  await image.raw().toBuffer();
}
