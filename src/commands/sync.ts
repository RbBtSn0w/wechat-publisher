import { loadConfig } from '../lib/config';
import { processPost } from '../lib/processor';
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
  try {
    const config = loadConfig(options.config);
    const fullPath = path.resolve(process.cwd(), postPath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    console.log(`Processing post: ${fullPath}`);
    const apiClient = new WeChatAPIClient(config);
    const uploader = new Uploader(apiClient);

    const post = await processPost(fullPath, config, options.dryRun ? undefined : uploader);

    if (options.dryRun) {
      console.log('--- Dry Run ---');
      console.log(`Title: ${post.title}`);
      console.log(`Author: ${post.author || config.author}`);
      console.log(`Digest: ${post.digest}`);
      
      // Create a filename safe title
      const safeTitle = post.title.replace(/[^\w\s\u4e00-\u9fa5]/gi, '').substring(0, 20).trim().replace(/\s+/g, '_');
      const debugPath = path.join(TEMP_PATHS.debug, `wechat-debug-${safeTitle}.html`);
      
      fs.writeFileSync(debugPath, post.contentHtml, 'utf8');
      console.log(`HTML Output saved to ${debugPath} for inspection.`);
      return;
    }
    
    const thumbMediaId = post.wechatThumbMediaId || 'DUMMY_MEDIA_ID_REPLACE_ME';
    if (thumbMediaId === 'DUMMY_MEDIA_ID_REPLACE_ME') {
      console.warn('Warning: No thumb_media_id provided. This may cause WeChat API to reject the draft.');
    }

    const article = {
      title: post.title,
      author: post.author || config.author,
      digest: post.digest,
      content: post.contentHtml,
      thumb_media_id: thumbMediaId,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    };

    console.log('Checking for duplicate drafts...');
    const drafts = await apiClient.getDrafts();
    let duplicateMediaId = null;
    for (const draft of drafts) {
      if (draft.content?.news_item?.[0]?.title === article.title) {
        duplicateMediaId = draft.media_id;
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
        await apiClient.updateDraft(duplicateMediaId, 0, article);
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
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}
