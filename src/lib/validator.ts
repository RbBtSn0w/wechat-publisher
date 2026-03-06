import fs from 'fs';

export function validateImage(localPath: string) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Image not found: ${localPath}`);
  }
  const stats = fs.statSync(localPath);
  const ext = localPath.split('.').pop()?.toLowerCase();
  const validExts = ['jpg', 'jpeg', 'png', 'gif'];
  
  if (!ext || !validExts.includes(ext)) {
    throw new Error(`Unsupported image format: ${ext}. WeChat only supports JPG, PNG, GIF.`);
  }

  if (stats.size > 2 * 1024 * 1024) {
    throw new Error(`Image too large: ${localPath}. Size is ${(stats.size/1024/1024).toFixed(2)}MB. Recommended limit is ~2MB.`);
  }
}
