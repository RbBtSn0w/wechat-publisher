import { loadConfig } from '../lib/config';
import { preparePostWithReport, executePreparedPost } from '../lib/processor';
import { WeChatAPIClient } from '../lib/api-client';
import { Uploader } from '../lib/uploader';
import { TEMP_PATHS } from '../lib/constants';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

interface SyncOptions { dryRun?: boolean; config?: string; force?: boolean }

function promptUser(query: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.once('close', () => resolve(false));
    rl.question(query, answer => { resolve(/^(y|yes)$/i.test(answer.trim())); rl.close(); });
  });
}

export async function syncCommand(postPath: string, options: SyncOptions) {
  const dryRun = Boolean(options.dryRun);
  const config = loadConfig(options.config, { requireCredentials: !dryRun });
  const fullPath = path.resolve(process.cwd(), postPath);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
  console.log(`Processing post: ${fullPath}`);
  const prepared = await preparePostWithReport(fullPath, config, {}, !dryRun);
  for (const diagnostic of prepared.result.diagnostics) {
    console.warn(`⚠️ ${diagnostic.message}${diagnostic.resource ? ` [${diagnostic.resource}]` : ''}`);
  }
  if (dryRun) {
    const { post, diagnostics, stats } = prepared.result;
    console.log('--- Dry Run ---');
    console.log(`Title: ${post.title}`);
    console.log(`Author: ${post.author}`);
    console.log(`Digest: ${post.digest}`);
    console.log(`Diagnostics: ${diagnostics.length}; degraded Mermaid: ${stats.degradedMermaid}`);
    const safeTitle = post.title.replace(/[^\w\s\u4e00-\u9fa5]/gi, '').substring(0, 20).trim().replace(/\s+/g, '_');
    const debugPath = path.join(TEMP_PATHS.debug, `wechat-debug-${safeTitle}.html`);
    fs.writeFileSync(debugPath, post.contentHtml, 'utf8');
    console.log(`HTML Output saved to ${debugPath} for inspection.`);
    return;
  }
  const apiClient = new WeChatAPIClient(config);
  const drafts = await apiClient.getAllDrafts();
  let duplicate: { mediaId: string; index: number } | undefined;
  for (const draft of drafts) {
    const index = (draft.content?.news_item || []).findIndex((item: { title?: string }) => item.title === prepared.result.post.title);
    if (index >= 0) { duplicate = { mediaId: draft.media_id, index }; break; }
  }
  if (duplicate && !options.force && !await promptUser(`Draft with title "${prepared.result.post.title}" already exists. Overwrite? (y/N) `)) {
    console.log('Operation cancelled by user. No assets uploaded.');
    return;
  }
  const { post } = await executePreparedPost(prepared, new Uploader(apiClient));
  const article = {
    title: post.title, author: post.author, digest: post.digest, content: post.contentHtml,
    thumb_media_id: post.wechatThumbMediaId, article_type: post.articleType,
    need_open_comment: 0, only_fans_can_comment: 0,
  };
  if (duplicate) {
    await apiClient.updateDraft(duplicate.mediaId, duplicate.index, article);
    console.log(`\n✅ Success! Draft updated (Media ID: ${duplicate.mediaId}).`);
  } else {
    const mediaId = await apiClient.addDraft([article]);
    console.log(`\n✅ Success! Draft created with Media ID: ${mediaId}`);
  }
}
