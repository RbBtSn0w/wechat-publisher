import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import axios from 'axios';
import sharp from 'sharp';
import { MermaidRenderer as SdkMermaidRenderer } from '@rbbtsn0w/wechat-markdown';
import { TEMP_PATHS } from './constants';

export class MermaidRenderer extends SdkMermaidRenderer {
  private tempDirectory: string;

  constructor() {
    super(TEMP_PATHS.mermaid);
    this.tempDirectory = TEMP_PATHS.mermaid;
    if (!fs.existsSync(this.tempDirectory)) {
      fs.mkdirSync(this.tempDirectory, { recursive: true });
    }
  }

  public override getHash(mermaidCode: string): string {
    return crypto.createHash('md5').update(mermaidCode.trim()).digest('hex');
  }

  public override getTargetPath(hash: string): string {
    return path.join(this.tempDirectory, `${hash}.png`);
  }

  /**
   * Preprocesses mermaid code to quote unquoted node labels with special characters like &, ?, (, )
   */
  public sanitizeMermaid(code: string): string {
    const sdkProto = SdkMermaidRenderer.prototype as unknown as { sanitizeMermaid?: (c: string) => string };
    if (typeof sdkProto.sanitizeMermaid === 'function') {
      return sdkProto.sanitizeMermaid(code);
    }
    return code
      .replace(/\[([^\]"'\n]+[&?()][^\]"'\n]*)\]/g, '["$1"]')
      .replace(/\{([^}"'\n]+[&?()][^}"'\n]*)\}/g, '{"$1"}');
  }

  public override async renderToImage(mermaidCode: string): Promise<string> {
    const hash = this.getHash(mermaidCode);
    const targetPath = this.getTargetPath(hash);

    if (fs.existsSync(targetPath)) {
      return targetPath;
    }

    // Delegate to SDK renderer if it has been updated with sanitizeMermaid
    const sdkProto = SdkMermaidRenderer.prototype as unknown as { sanitizeMermaid?: (c: string) => string };
    if (typeof sdkProto.sanitizeMermaid === 'function') {
      return super.renderToImage(mermaidCode);
    }

    const sanitized = this.sanitizeMermaid(mermaidCode.trim());
    const data = Buffer.from(sanitized, 'utf8');
    const compressed = zlib.deflateSync(data, { level: 9 });
    const result = Buffer.from(compressed)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const urls = [
      `https://kroki.io/mermaid/png/${result}`,
      `https://kroki.io/mermaid/svg/${result}`,
    ];

    let lastError: Error | null = null;

    for (const url of urls) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const isSvg = url.includes('/svg/');
          const response = await axios.get(url, {
            responseType: isSvg ? 'text' : 'arraybuffer',
            timeout: 30000,
          });

          if (isSvg) {
            const svgBuffer = Buffer.from(response.data as string, 'utf8');
            await sharp(svgBuffer).png({ quality: 95 }).toFile(targetPath);
          } else {
            fs.writeFileSync(targetPath, response.data as Buffer);
          }

          return targetPath;
        } catch (err: unknown) {
          lastError = err as Error;
          if (attempt < 3) {
            await new Promise((res) => setTimeout(res, 1000 * attempt));
          }
        }
      }
    }

    throw new Error(`Failed to render Mermaid diagram after retries: ${lastError?.message || 'Unknown error'}`);
  }
}

