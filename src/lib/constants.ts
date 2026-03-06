import path from 'path';
import fs from 'fs';

/**
 * Robustly find the repository root directory.
 */
export function getRepoRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('wechat-publisher')) {
    return path.dirname(cwd);
  }
  
  const subProjectPath = path.join(cwd, 'wechat-publisher');
  if (fs.existsSync(subProjectPath) && fs.statSync(subProjectPath).isDirectory()) {
    return cwd;
  }
  
  return cwd;
}

/**
 * Robustly find the wechat-publisher project root directory.
 */
export function getPublisherRoot(): string {
  const root = getRepoRoot();
  return path.join(root, 'wechat-publisher');
}

/**
 * Get the path to the unified .temp directory.
 */
export function getTempDir(): string {
  const root = getPublisherRoot();
  const tempDir = path.join(root, '.temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

export const TEMP_PATHS = {
  get base() { return getTempDir(); },
  get mermaid() { 
    const p = path.join(getTempDir(), 'mermaid-cache');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
  },
  get debug() {
    const p = path.join(getTempDir(), 'debug');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    return p;
  },
  get cacheFile() {
    return path.join(getTempDir(), 'wechat-cache.json');
  }
};
