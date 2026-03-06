import axios from 'axios';
import pako from 'pako';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class MermaidRenderer {
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(process.cwd(), 'wechat-publisher', '.mermaid-cache');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async renderToImage(mermaidCode: string): Promise<string> {
    // Generate a hash for the code to use as cache key
    const hash = crypto.createHash('md5').update(mermaidCode).digest('hex');
    const targetPath = path.join(this.tempDir, `${hash}.png`);

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
