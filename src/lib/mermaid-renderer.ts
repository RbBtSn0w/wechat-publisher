import axios from 'axios';
import pako from 'pako';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TEMP_PATHS } from './constants';

export class MermaidRenderer {
  private tempDir: string;

  constructor() {
    this.tempDir = TEMP_PATHS.mermaid;
  }

  getHash(mermaidCode: string): string {
    return crypto.createHash('md5').update(mermaidCode).digest('hex');
  }

  getTargetPath(hash: string): string {
    return path.join(this.tempDir, `${hash}.png`);
  }

  async renderToImage(mermaidCode: string): Promise<string> {
    // Generate a hash for the code to use as cache key
    const hash = this.getHash(mermaidCode);
    const targetPath = this.getTargetPath(hash);

    if (fs.existsSync(targetPath)) {
      return targetPath;
    }

    // Kroki.io expects zlib compressed + base64url encoded data
    const data = Buffer.from(mermaidCode, 'utf8');
    const compressed = pako.deflate(data, { level: 9 });
    const result = Buffer.from(compressed).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const url = `https://kroki.io/mermaid/png/${result}`;

    console.log(`Rendering Mermaid diagram via Kroki...`);
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(targetPath, response.data);

    return targetPath;
  }
}
