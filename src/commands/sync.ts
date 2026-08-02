import { loadConfig } from '../lib/config';
import { processPostWithReport } from '../lib/processor';
import { assertValidArticle } from '../lib/article-validator';
import { WeChatAPIClient } from '../lib/api-client';
import { Uploader } from '../lib/uploader';
import { TEMP_PATHS } from '../lib/constants';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

function promptUser(query: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export async function syncCommand(postPath: string, options: any) {
  const dryRun = Boolean(options.dryRun);
  const config = loadConfig(options.config, { requireCredentials: !dryRun });
    const fullPath = path.resolve(process.cwd(), postPath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    console.log(`Processing post: ${fullPath}`);
    const apiClient = dryRun ? undefined : new WeChatAPIClient(config);
    const uploader = apiClient ? new Uploader(apiClient) : undefined;

    const result = await processPostWithReport(fullPath, config, uploader);
    const post = result.post;
    for (const diagnostic of result.diagnostics) {
      console.warn(`⚠️ ${diagnostic.message}${diagnostic.resource ? ` [${diagnostic.resource}]` : ''}`);
    }

    if (dryRun) {
      console.log('--- Dry Run ---');
      console.log(`Title: ${post.title}`);
      console.log(`Author: ${post.author || config.author}`);
      console.log(`Digest: ${post.digest}`);
      console.log(`Diagnostics: ${result.diagnostics.length}; degraded Mermaid: ${result.stats.degradedMermaid}`);
      
      // Create a filename safe title
      const safeTitle = post.title.replace(/[^\w\s\u4e00-\u9fa5]/gi, '').substring(0, 20).trim().replace(/\s+/g, '_');
      const debugPath = path.join(TEMP_PATHS.debug, `wechat-debug-${safeTitle}.html`);
      
      fs.writeFileSync(debugPath, post.contentHtml, 'utf8');
      console.log(`HTML Output saved to ${debugPath} for inspection.`);
      return;
    }

    if (!apiClient) throw new Error('WeChat API client is required for a real sync.');
    
    const thumbMediaId = post.wechatThumbMediaId || '';

    const article = {
      title: post.title,
      author: post.author || config.author || '',
      digest: post.digest,
      content: post.contentHtml,
      thumb_media_id: thumbMediaId,
      article_type: post.articleType || 'news',
      need_open_comment: 0,
      only_fans_can_comment: 0,
    };

    assertValidArticle({
      title: article.title,
      author: article.author,
      digest: article.digest,
      content: article.content,
      thumbMediaId,
      articleType: article.article_type,
    }, config.limits);

    console.log('Checking for duplicate drafts...');
    const drafts = await apiClient.getAllDrafts();
    let duplicateMediaId = null;
    let duplicateIndex = 0;
    for (const draft of drafts) {
      const newsItems = draft.content?.news_item || [];
      const index = newsItems.findIndex((item: any) => item.title === article.title);
      if (index >= 0) {
        duplicateMediaId = draft.media_id;
        duplicateIndex = index;
        break;
      }
    }

    if (duplicateMediaId) {
      let overwrite = options.force; // If force is true, we skip the prompt
      
      if (!overwrite) {
        overwrite = await promptUser(`Draft with title "${article.title}" already exists. Overwrite? (y/N) `);
      } else {
        console.log(`Duplicate found: "${article.title}". --force is enabled, overwriting...`);
      }

      if (overwrite) {
        console.log(`Updating existing draft (Media ID: ${duplicateMediaId})...`);
        await apiClient.updateDraft(duplicateMediaId, duplicateIndex, article);
        console.log(`\n✅ Success! Draft updated.`);
        return;
      } else {
        console.log('Operation cancelled by user.');
        return;
      }
    }

    console.log('Uploading to WeChat Draft Box...');
    const mediaId = await apiClient.addDraft([article]);
    
    console.log(`\n✅ Success! Draft created with Media ID: ${mediaId}`);
}
