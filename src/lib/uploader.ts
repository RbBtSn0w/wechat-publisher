import fs from 'fs';
import FormData from 'form-data';
import { WeChatAPIClient } from './api-client';
import { validateUploadableImage } from './media';
import { requireWriteField, UnknownWriteOutcomeError } from './write-outcome';

export class Uploader {
  constructor(private apiClient: WeChatAPIClient) {}

  async uploadImage(localPath: string): Promise<string> {
    await validateUploadableImage(localPath, 'content');

    const token = await this.apiClient.getAccessToken();
    const response = await this.apiClient.postMultipart('/cgi-bin/media/uploadimg', () => {
      const form = new FormData();
      form.append('media', fs.createReadStream(localPath));
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

  async uploadPermanentImage(localPath: string): Promise<string> {
    await validateUploadableImage(localPath, 'permanent');

    const token = await this.apiClient.getAccessToken();
    const response = await this.apiClient.postMultipart('/cgi-bin/material/add_material', () => {
      const form = new FormData();
      form.append('media', fs.createReadStream(localPath));
      form.append('type', 'image');
      return { body: form, headers: form.getHeaders() };
    }, {
      params: { access_token: token, type: 'image' },
    });

    return requireWriteField(response.data, 'media_id', 'Upload permanent material');
  }
}
