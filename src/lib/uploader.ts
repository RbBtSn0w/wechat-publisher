import path from 'path';
import FormData from 'form-data';
import { WeChatAPIClient } from './api-client';
import { readValidatedUploadImage } from './media';
import { requireWriteField, UnknownWriteOutcomeError } from './write-outcome';

export class Uploader {
  constructor(private apiClient: WeChatAPIClient) {}

  async uploadImage(localPath: string, snapshot?: Buffer): Promise<string> {
    const bytes = await readValidatedUploadImage(localPath, 'content', snapshot);

    const token = await this.apiClient.getAccessToken();
    const response = await this.apiClient.postMultipart('/cgi-bin/media/uploadimg', () => {
      const form = new FormData();
      form.append('media', bytes, { filename: path.basename(localPath) });
      return { body: form, headers: form.getHeaders() };
    }, {
      params: { access_token: token },
      timeout: 15_000,
    });

    const url = requireWriteField(response.data, 'url', 'Upload image');
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Invalid protocol');
    } catch {
      throw new UnknownWriteOutcomeError('Upload image');
    }
    return url;
  }

  async uploadPermanentImage(localPath: string, snapshot?: Buffer): Promise<string> {
    const bytes = await readValidatedUploadImage(localPath, 'permanent', snapshot);

    const token = await this.apiClient.getAccessToken();
    const response = await this.apiClient.postMultipart('/cgi-bin/material/add_material', () => {
      const form = new FormData();
      form.append('media', bytes, { filename: path.basename(localPath) });
      form.append('type', 'image');
      return { body: form, headers: form.getHeaders() };
    }, {
      params: { access_token: token, type: 'image' },
    });

    return requireWriteField(response.data, 'media_id', 'Upload permanent material');
  }
}
