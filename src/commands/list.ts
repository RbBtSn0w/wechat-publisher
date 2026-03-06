import { loadConfig } from '../lib/config';
import { WeChatAPIClient } from '../lib/api-client';

export async function listCommand(countStr: string | undefined, options: any) {
  try {
    const config = loadConfig(options.config);
    const count = parseInt(countStr || '10', 10);
    const apiClient = new WeChatAPIClient(config);

    console.log(`Fetching latest ${count} drafts...`);
    const drafts = await apiClient.getDrafts(0, count);

    if (drafts.length === 0) {
      console.log('No drafts found.');
      return;
    }

    drafts.forEach((draft, index) => {
      const title = draft.content?.news_item?.[0]?.title || 'Untitled';
      const time = new Date(draft.update_time * 1000).toLocaleString();
      console.log(`[${index + 1}] Title: ${title}`);
      console.log(`    Media ID: ${draft.media_id}`);
      console.log(`    Updated: ${time}\n`);
    });
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}
