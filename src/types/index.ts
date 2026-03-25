export type WeChatArticleType = 'news' | 'newspic';

export interface AppConfig {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  siteUrl?: string;
  postsDir: string;
  assetsDir: string;
  author?: string;
  style?: string;
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

export interface MediaMap {
  localPath: string;
  wechatUrl: string;
  lastUploaded: Date;
}

export interface DraftResult {
  mediaId: string;
  articleId?: string;
  syncTime: Date;
}
