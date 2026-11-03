import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AppConfig } from '../types';
import { TEMP_PATHS } from './constants';

export interface CacheScope { appId: string; baseUrl?: string }
export interface ResourceCacheOptions { scope?: CacheScope; cacheRoot?: string }

export function cacheScope(config: Pick<AppConfig, 'appId' | 'baseUrl'>): CacheScope {
  return { appId: config.appId, baseUrl: config.baseUrl };
}

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const inFlight = new Map<string, Promise<string>>();

function canonicalBaseUrl(baseUrl = 'https://api.weixin.qq.com'): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return baseUrl;
  }
}

export class ResourceCache {
  private namespace: string;
  private cacheRoot?: string;

  constructor(options: ResourceCacheOptions = {}) {
    const scope = options.scope;
    // Unscoped callers get a separate namespace; legacy caches are never reused.
    this.namespace = hash(scope ? JSON.stringify(['scoped', scope.appId, canonicalBaseUrl(scope.baseUrl)]) : 'unscoped');
    this.cacheRoot = options.cacheRoot;
  }

  private get directory(): string {
    return path.resolve(this.cacheRoot ?? path.join(TEMP_PATHS.base, 'resource-cache-v2'), this.namespace);
  }

  private entryPath(key: string): string { return path.join(this.directory, `${hash(key)}.json`); }

  get(localPath: string, fingerprint?: string): string | null {
    try {
      const entry = JSON.parse(fs.readFileSync(this.entryPath(localPath), 'utf8'));
      if (entry?.version !== 2 || entry.keyHash !== hash(localPath) || typeof entry.wechatUrl !== 'string' || !entry.wechatUrl.trim()) return null;
      return fingerprint === undefined || entry.fingerprint === fingerprint ? entry.wechatUrl : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Resource cache read failed; treating entry as a cache miss.');
      return null;
    }
  }

  set(localPath: string, wechatUrl: string, fingerprint?: string): void {
    let temporary: string | undefined;
    try {
      const target = this.entryPath(localPath);
      temporary = `${target}.${crypto.randomUUID()}.tmp`;
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ version: 2, keyHash: hash(localPath), wechatUrl, fingerprint }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      // Each independent key owns one file; concurrent writers cannot erase other entries.
      fs.renameSync(temporary, target);
    } catch {
      console.warn('Resource cache write failed; the successful upload result remains available.');
    } finally {
      if (temporary) {
        try { fs.unlinkSync(temporary); } catch { /* Renamed or never created. */ }
      }
    }
  }

  async getOrUpload(key: string, fingerprint: string | undefined, producer: () => Promise<string>): Promise<string> {
    const cached = this.get(key, fingerprint);
    if (cached) return cached;
    let directory: string;
    try { directory = this.directory; } catch { directory = `unavailable:${this.namespace}`; }
    const identity = JSON.stringify([directory, key, fingerprint]);
    const pending = inFlight.get(identity);
    if (pending) return pending;
    const upload = Promise.resolve().then(producer).then(value => {
      this.set(key, value, fingerprint);
      return value;
    });
    inFlight.set(identity, upload);
    try { return await upload; } finally { inFlight.delete(identity); }
  }
}

export function fingerprintFile(localPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex');
}
