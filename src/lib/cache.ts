import fs from 'fs';
import path from 'path';
import { MediaMap } from '../types';

const CACHE_FILE = '.wechat-cache.json';

export class ResourceCache {
  private cache: Record<string, MediaMap> = {};
  private cachePath: string;

  constructor() {
    const defaultPath = path.resolve(process.cwd(), CACHE_FILE);
    const subProjectPath = path.resolve(process.cwd(), 'wechat-publisher', CACHE_FILE);
    
    if (fs.existsSync(defaultPath)) {
      this.cachePath = defaultPath;
    } else if (fs.existsSync(subProjectPath)) {
      this.cachePath = subProjectPath;
    } else {
      // Default to sub-project if neither exists
      this.cachePath = subProjectPath;
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
