import axios, { AxiosInstance } from 'axios';
import { AppConfig } from '../types';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  errcode?: number;
  errmsg?: string;
}

export class WeChatAPIClient {
  private config: AppConfig;
  private http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: AppConfig) {
    this.config = config;
    this.http = axios.create({
      baseURL: this.config.baseUrl,
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const response = await this.http.get<TokenResponse>('/cgi-bin/token', {
      params: {
        grant_type: 'client_credential',
        appid: this.config.appId,
        secret: this.config.appSecret,
      },
    });

    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to get access token: ${response.data.errmsg} (${response.data.errcode})`);
    }

    this.accessToken = response.data.access_token;
    // Refresh 5 minutes before actual expiration
    this.tokenExpiresAt = Date.now() + (response.data.expires_in - 300) * 1000;

    return this.accessToken;
  }

  async addDraft(articles: any[]): Promise<string> {
    const token = await this.getAccessToken();
    const response = await this.http.post(
      '/cgi-bin/draft/add',
      { articles },
      { params: { access_token: token } }
    );
    
    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to add draft: ${response.data.errmsg} (${response.data.errcode})`);
    }

    return response.data.media_id;
  }

  async getDrafts(offset: number = 0, count: number = 20): Promise<any[]> {
    const token = await this.getAccessToken();
    const response = await this.http.post(
      '/cgi-bin/draft/batchget',
      { offset, count, no_content: 1 },
      { params: { access_token: token } }
    );
    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to get drafts: ${response.data.errmsg} (${response.data.errcode})`);
    }
    return response.data.item || [];
  }
  
  async updateDraft(mediaId: string, index: number, article: any): Promise<void> {
    const token = await this.getAccessToken();
    const response = await this.http.post(
      '/cgi-bin/draft/update',
      { media_id: mediaId, index, articles: article },
      { params: { access_token: token } }
    );
    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to update draft: ${response.data.errmsg} (${response.data.errcode})`);
    }
  }
}
