import fs from 'fs';
import path from 'path';
import { MediaMap } from '../types';
import { TEMP_PATHS } from './constants';

const CACHE_FILE = '.wechat-cache.json';

export class ResourceCache {
  private cache: Record<string, MediaMap> = {};
  private cachePath: string;

  constructor() {
    this.cachePath = TEMP_PATHS.cacheFile;
    
    // Check for legacy cache file in old locations for migration
    const legacyPaths = [
      path.resolve(process.cwd(), CACHE_FILE),
      path.resolve(process.cwd(), 'wechat-publisher', CACHE_FILE)
    ];

    for (const p of legacyPaths) {
      if (fs.existsSync(p) && !fs.existsSync(this.cachePath)) {
        console.log(`Migrating cache from ${p} to ${this.cachePath}`);
        fs.renameSync(p, this.cachePath);
        break;
      }
    }
    
    this.load();
  }

  private load() {
    if (fs.existsSync(this.cachePath)) {
      const fileContents = fs.readFileSync(this.cachePath, 'utf8');
      try {
        this.cache = JSON.parse(fileContents) || {};
      } catch (e) {
        console.warn('Failed to parse cache file, starting with empty cache.');
        this.cache = {};
      }
    }
  }

  private save() {
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8');
  }

  get(localPath: string): string | null {
    const entry = this.cache[localPath];
    if (entry) {
      return entry.wechatUrl;
    }
    return null;
  }

  set(localPath: string, wechatUrl: string) {
    this.cache[localPath] = {
      localPath,
      wechatUrl,
      lastUploaded: new Date(),
    };
    this.save();
  }
}
