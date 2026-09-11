import fs from 'fs';
import path from 'path';
import { loadConfig } from '../lib/config';
import { WeChatAPIClient } from '../lib/api-client';
import { Uploader } from '../lib/uploader';
import { ResourceCache } from '../lib/cache';
import { TEMP_PATHS } from '../lib/constants';
import {
  discoverDraftDirectories,
  readDraftPayloadFromDirectory,
  resolveDraftPayloadMedia,
} from '../lib/directory-draft';
import { formatErrorWithHints } from '../lib/error-hints';

export async function publishDirCommand(directory: string, options: any) {
  try {
    const fullDir = path.resolve(process.cwd(), directory);
    if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) {
      throw new Error(`Directory not found: ${fullDir}`);
    }

    const targetDirs = options.all
      ? discoverDraftDirectories(fullDir)
      : [fullDir];

    if (targetDirs.length === 0) {
      throw new Error(`No valid draft directories found under ${fullDir}.`);
    }

    const cache = new ResourceCache();
    const config = options.dryRun ? undefined : loadConfig(options.config);
    const apiClient = config ? new WeChatAPIClient(config) : undefined;
    const uploader = apiClient ? new Uploader(apiClient) : undefined;

    if (!options.dryRun && !apiClient) {
      throw new Error('WeChat API client is required when dry-run is false.');
    }

    let successCount = 0;
    for (const draftDir of targetDirs) {
      const rawPayload = readDraftPayloadFromDirectory(draftDir);
      const dirName = path.basename(draftDir);
      if (targetDirs.length > 1) {
        console.log(`\nProcessing draft directory: ${dirName}`);
      }

      const { payload, stats } = await resolveDraftPayloadMedia(rawPayload, {
        directory: draftDir,
        cache,
        uploader: options.dryRun ? undefined : uploader,
        dryRun: Boolean(options.dryRun),
      });

      if (options.dryRun) {
        const debugFile = path.join(TEMP_PATHS.debug, `wechat-publish-dir-dryrun-${dirName}-${Date.now()}.json`);
        fs.writeFileSync(debugFile, JSON.stringify(payload, null, 2), 'utf8');
        console.log('--- Dry Run ---');
        console.log(`Directory: ${draftDir}`);
        console.log(`Articles: ${payload.articles.length}`);
        console.log(`Resolved placeholders: ${stats.placeholderCount}`);
        console.log(`Resolved payload saved to: ${debugFile}`);
        successCount += 1;
      } else {
        console.log(`Uploading resolved payload with ${payload.articles.length} article(s) to WeChat Draft Box...`);
        const mediaId = await apiClient!.addDraft(payload.articles);
        console.log(`\n✅ Success! Draft [${dirName}] created with Media ID: ${mediaId}`);
        successCount += 1;
      }
    }

    if (targetDirs.length > 1) {
      console.log(`\n🎉 Batch completed: ${successCount} / ${targetDirs.length} drafts processed successfully.`);
    }
  } catch (err: any) {
    console.error(formatErrorWithHints(err.message));
    process.exit(1);
  }
}
