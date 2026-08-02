export type WeChatArticleType = 'news' | 'newspic';

export type DiagnosticSeverity = 'warning' | 'error';

export interface ConversionDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  sourcePath?: string;
  line?: number;
  resource?: string;
}

export interface ConversionStats {
  uploadedImages: number;
  uploadedCovers: number;
  renderedMermaid: number;
  renderedFormulas: number;
  degradedMermaid: number;
}

export interface SyncLimits {
  title: number;
  author: number;
  digest: number;
  contentCharacters: number;
  contentBytes: number;
}

export const DEFAULT_SYNC_LIMITS: SyncLimits = {
  title: 64,
  author: 16,
  digest: 128,
  // The live draft endpoint has accepted current blog output above 20K
  // characters; keep a conservative 100K local guard and retain the 1MB
  // byte limit. Projects can override this through config.limits.
  contentCharacters: 100_000,
  contentBytes: 1_048_576,
};

export interface AppConfig {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  siteUrl?: string;
  postsDir: string;
  assetsDir: string;
  author?: string;
  style?: string;
  limits?: Partial<SyncLimits>;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

export interface BlogPost {
  title: string;
  author: string;
  digest: string;
  contentMarkdown: string;
  contentHtml: string;
  localThumbPath: string;
  wechatThumbMediaId: string;
  articleType: WeChatArticleType;
  originalPath: string;
}

export interface ProcessResult {
  post: BlogPost;
  diagnostics: ConversionDiagnostic[];
  stats: ConversionStats;
}

export interface MediaMap {
  localPath: string;
  wechatUrl: string;
  lastUploaded: Date;
  fingerprint?: string;
}

export interface DraftResult {
  mediaId: string;
  articleId?: string;
  syncTime: Date;
}
