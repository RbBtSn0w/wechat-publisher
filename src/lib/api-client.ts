import axios, { AxiosInstance } from 'axios';
import { AppConfig } from '../types';
import { checkBusinessError, requireWriteField, responseObject, UnknownWriteOutcomeError } from './write-outcome';
export { UnknownWriteOutcomeError } from './write-outcome';

export class WeChatAPIClient {
  private http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private config: AppConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.requestTimeoutMs || 15_000,
      // Redirects can replay writes and forward credentials to another host.
      maxRedirects: 0,
    });
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    const configuredRetries = this.config.maxRetries ?? 3;
    const retries = Number.isFinite(configuredRetries) ? Math.min(5, Math.max(0, Math.floor(configuredRetries))) : 3;
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const retryable = axios.isAxiosError(error) && (!error.response || status === 408 || status === 429 || (status !== undefined && status >= 500));
        if (!retryable || attempt >= retries) {
          throw new Error(`WeChat read request failed${status === undefined ? '' : ` (HTTP ${status})`}.`);
        }
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
  }

  private async write<T>(operation: string, request: () => Promise<{ data: T }>): Promise<{ data: T }> {
    let response: { data: T };
    try {
      response = await request();
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === undefined || status === 408 || status >= 500) throw new UnknownWriteOutcomeError(operation);
      throw new Error(`${operation}: request failed (HTTP ${status}).`);
    }
    checkBusinessError(response.data, operation);
    const data = responseObject(response.data);
    if (!data || (data.errcode !== undefined && data.errcode !== 0)) throw new UnknownWriteOutcomeError(operation);
    return response;
  }

  async postMultipart<T = any>(
    path: string,
    createRequest: () => { body: unknown; headers: Record<string, string> },
    config: Record<string, unknown>
  ): Promise<{ data: T }> {
    // Build the stream once; never replay an upload whose result was lost.
    const request = createRequest();
    return this.write('Upload media', () => this.http.post<T>(path, request.body, {
      ...config,
      maxRedirects: 0,
      headers: { ...request.headers, ...(config.headers as Record<string, string> | undefined) },
    }));
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    const response = await this.read(() => this.http.get('/cgi-bin/token', {
      params: { grant_type: 'client_credential', appid: this.config.appId, secret: this.config.appSecret },
    }));
    checkBusinessError(response.data, 'Get access token');
    const data = responseObject(response.data);
    if (!data || typeof data.access_token !== 'string' || !data.access_token.trim()
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new Error('Invalid token response.');
    }
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(0, data.expires_in - 300) * 1000;
    return this.accessToken;
  }

  async addDraft(articles: any[]): Promise<string> {
    const token = await this.getAccessToken();
    const response = await this.write('Add draft', () => this.http.post('/cgi-bin/draft/add', { articles }, { params: { access_token: token } }));
    return requireWriteField(response.data, 'media_id', 'Add draft');
  }

  async getDrafts(offset = 0, count = 20, includeContent = false): Promise<any[]> {
    const token = await this.getAccessToken();
    const response = await this.read(() => this.http.post('/cgi-bin/draft/batchget',
      { offset, count, no_content: includeContent ? 0 : 1 }, { params: { access_token: token } }));
    checkBusinessError(response.data, 'Get drafts');
    const data = responseObject(response.data);
    if (!data || !Array.isArray(data.item)) throw new Error('Invalid draft list response.');
    return data.item;
  }

  async getAllDrafts(): Promise<any[]> {
    const allDrafts: any[] = [];
    const pageSize = 20;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.getDrafts(offset, pageSize, true);
      allDrafts.push(...page);
      if (page.length < pageSize) return allDrafts;
    }
  }

  async updateDraft(mediaId: string, index: number, article: any): Promise<void> {
    const token = await this.getAccessToken();
    const response = await this.write('Update draft', () => this.http.post('/cgi-bin/draft/update',
      { media_id: mediaId, index, articles: article }, { params: { access_token: token } }));
    if (responseObject(response.data)?.errcode !== 0) throw new UnknownWriteOutcomeError('Update draft');
  }
}
