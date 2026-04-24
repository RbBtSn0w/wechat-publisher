import fs from 'fs';
import path from 'path';
import { loadConfig } from '../lib/config';
import { WeChatAPIClient } from '../lib/api-client';
import { Uploader } from '../lib/uploader';
import { ResourceCache } from '../lib/cache';
import { TEMP_PATHS } from '../lib/constants';
import { readDraftPayloadFromDirectory, resolveDraftPayloadMedia } from '../lib/directory-draft';
import { formatErrorWithHints } from '../lib/error-hints';

export async function publishDirCommand(directory: string, options: any) {
  try {
    const config = loadConfig(options.config);
    const fullDir = path.resolve(process.cwd(), directory);
    if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) {
      throw new Error(`Directory not found: ${fullDir}`);
    }

    const rawPayload = readDraftPayloadFromDirectory(fullDir);
    const cache = new ResourceCache();
    const apiClient = new WeChatAPIClient(config);
    const uploader = new Uploader(apiClient);

    const { payload, stats } = await resolveDraftPayloadMedia(rawPayload, {
      directory: fullDir,
      cache,
      uploader: options.dryRun ? undefined : uploader,
      dryRun: Boolean(options.dryRun),
    });

    if (options.dryRun) {
      const debugFile = path.join(TEMP_PATHS.debug, `wechat-publish-dir-dryrun-${Date.now()}.json`);
      fs.writeFileSync(debugFile, JSON.stringify(payload, null, 2), 'utf8');
      console.log('--- Dry Run ---');
      console.log(`Directory: ${fullDir}`);
      console.log(`Articles: ${payload.articles.length}`);
      console.log(`Resolved placeholders: ${stats.placeholderCount}`);
      console.log(`Resolved payload saved to: ${debugFile}`);
      return;
    }

    console.log(`Uploading resolved payload with ${payload.articles.length} article(s) to WeChat Draft Box...`);
    const mediaId = await apiClient.addDraft(payload.articles);
    console.log(`\n✅ Success! Draft created with Media ID: ${mediaId}`);
  } catch (err: any) {
    console.error(formatErrorWithHints(err.message));
    process.exit(1);
  }
}
