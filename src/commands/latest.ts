import fs from 'fs';
import path from 'path';
import { loadConfig } from '../lib/config';
import { formatErrorWithHints } from '../lib/error-hints';
import { syncCommand } from './sync';

export async function latestCommand(countStr: string | undefined, options: any) {
  const config = loadConfig(options.config, { requireCredentials: !options.dryRun });
    const count = parseInt(countStr || '1', 10);
    const postsDir = path.resolve(process.cwd(), config.postsDir);

    if (!fs.existsSync(postsDir)) {
      throw new Error(`postsDir not found at ${postsDir}`);
    }

    // Get all markdown files and sort by name descending (latest first)
    const files = fs.readdirSync(postsDir)
      .filter(f => f.endsWith('.md') || f.endsWith('.markdown'))
      .sort()
      .reverse()
      .slice(0, count);

    if (files.length === 0) {
      console.log('No posts found in the specified directory.');
      return;
    }

    console.log(`🚀 Found ${files.length} latest post(s) in ${config.postsDir}. Starting batch sync...\n`);

    let failed = 0;
    for (const [index, file] of files.entries()) {
      const relativePath = path.join(config.postsDir, file);
      console.log(`\n--------------------------------------------------`);
      console.log(`📦 [Batch ${index + 1}/${files.length}] syncing: ${file}`);
      
      try {
        await syncCommand(relativePath, options);
      } catch (err: any) {
        failed += 1;
        console.error(formatErrorWithHints(`Error syncing ${file}: ${err.message}`));
        console.log(`Continuing with next file...`);
      }
    }

    console.log(`\n✨ Batch sync completed! succeeded=${files.length - failed}, failed=${failed}`);
    if (failed > 0) process.exitCode = 1;
}
