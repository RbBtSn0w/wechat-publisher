import fs from 'fs';
import FormData from 'form-data';
import { WeChatAPIClient } from './api-client';
import { validateImage } from './validator';

export class Uploader {
  constructor(private apiClient: WeChatAPIClient) {}

  async uploadImage(localPath: string): Promise<string> {
    validateImage(localPath);

    const token = await this.apiClient.getAccessToken();
    const response = await this.apiClient.postMultipart('/cgi-bin/media/uploadimg', () => {
      const form = new FormData();
      form.append('media', fs.createReadStream(localPath));
      return { body: form, headers: form.getHeaders() };
    }, {
      params: { access_token: token },
      timeout: 15_000,
    });

    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to upload image: ${response.data.errmsg} (${response.data.errcode})`);
    }

    return response.data.url;
  }

  async uploadPermanentImage(localPath: string): Promise<string> {
    validateImage(localPath);

    const token = await this.apiClient.getAccessToken();
    const response = await this.apiClient.postMultipart('/cgi-bin/material/add_material', () => {
      const form = new FormData();
      form.append('media', fs.createReadStream(localPath));
      form.append('type', 'image');
      return { body: form, headers: form.getHeaders() };
    }, {
      params: { access_token: token, type: 'image' },
    });

    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to upload permanent material: ${response.data.errmsg} (${response.data.errcode})`);
    }

    return response.data.media_id;
  }
}
