import axios from 'axios';
import crypto from 'crypto';
import dns from 'node:dns/promises';
import fs from 'fs';
import net from 'node:net';
import path from 'path';
import sharp from 'sharp';
import { TEMP_PATHS } from './constants';

const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;

export interface RemoteImageDownloaderOptions {
  // Only intended for controlled local integration tests. Production callers must keep this disabled.
  allowPrivateNetworks?: boolean;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [first, second] = octets;
  return first === 0
    || first === 10
    || (first === 100 && second >= 64 && second <= 127)
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51)
    || (first === 203 && second === 0)
    || first >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;

  const mappedIpv4 = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4[1]) : false;
}

function isPrivateAddress(address: string): boolean {
  return net.isIP(address) === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

async function assertPublicRemoteTarget(parsed: URL): Promise<void> {
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Remote image target resolves to a private or local address: ' + hostname);
  }

  const literalAddress = net.isIP(hostname) ? hostname : undefined;
  const addresses = literalAddress
    ? [{ address: literalAddress }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    const resolved = addresses.map(({ address }) => address).join(', ') || hostname;
    throw new Error('Remote image target resolves to a private or local address: ' + resolved);
  }
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('webp')) return '.webp';
  throw new Error(`Unsupported remote image content type: ${contentType || 'missing'}`);
}

export class RemoteImageDownloader {
  private readonly options: RemoteImageDownloaderOptions;

  constructor(options: RemoteImageDownloaderOptions = {}) {
    this.options = options;
  }

  async download(url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported remote image protocol: ${parsed.protocol}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error('Remote image URLs must not contain credentials.');
    }
    if (!this.options.allowPrivateNetworks) {
      await assertPublicRemoteTarget(parsed);
    }

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      maxContentLength: MAX_REMOTE_IMAGE_BYTES,
      maxBodyLength: MAX_REMOTE_IMAGE_BYTES,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 300,
    });
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const extension = extensionForContentType(contentType);
    const hash = crypto.createHash('sha256').update(Buffer.from(response.data)).digest('hex');
    const directory = TEMP_PATHS.remoteImage;
    const downloadedPath = path.join(directory, `${hash}${extension}`);

    if (!fs.existsSync(downloadedPath)) {
      const data = Buffer.from(response.data);
      const output = extension === '.webp' ? await sharp(data).png().toBuffer() : data;
      const outputPath = extension === '.webp' ? path.join(directory, `${hash}.png`) : downloadedPath;
      fs.writeFileSync(outputPath, output);
      return outputPath;
    }

    return downloadedPath;
  }
}
