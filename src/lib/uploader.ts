import fs from 'fs';
import FormData from 'form-data';
import { WeChatAPIClient } from './api-client';
import { validateImage } from './validator';

export class Uploader {
  constructor(private apiClient: WeChatAPIClient) {}

  async uploadImage(localPath: string): Promise<string> {
    validateImage(localPath);

    const token = await this.apiClient.getAccessToken();
    const form = new FormData();
    form.append('media', fs.createReadStream(localPath));

    const response = await (this.apiClient as any).http.post('/cgi-bin/media/uploadimg', form, {
      params: { access_token: token },
      headers: form.getHeaders(),
    });

    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to upload image: ${response.data.errmsg} (${response.data.errcode})`);
    }

    return response.data.url;
  }

  async uploadPermanentImage(localPath: string): Promise<string> {
    validateImage(localPath);

    const token = await this.apiClient.getAccessToken();
    const form = new FormData();
    form.append('media', fs.createReadStream(localPath));
    form.append('type', 'image');

    const response = await (this.apiClient as any).http.post('/cgi-bin/material/add_material', form, {
      params: { access_token: token, type: 'image' },
      headers: form.getHeaders(),
    });

    if (response.data.errcode && response.data.errcode !== 0) {
      throw new Error(`Failed to upload permanent material: ${response.data.errmsg} (${response.data.errcode})`);
    }

    return response.data.media_id;
  }
}
