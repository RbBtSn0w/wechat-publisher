#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { syncCommand } from '../src/commands/sync';
import { listCommand } from '../src/commands/list';
import { initCommand } from '../src/commands/init';
import { latestCommand } from '../src/commands/latest';
import { publishDirCommand } from '../src/commands/publish-dir';

// Helper to get version from package.json regardless of whether we are running from /bin or /dist/bin
const getVersion = () => {
  const pkgPaths = [
    path.join(__dirname, '../package.json'),    // Running from /bin (ts-node)
    path.join(__dirname, '../../package.json'), // Running from /dist/bin (compiled)
  ];
  for (const p of pkgPaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8')).version;
    }
  }
  return 'unknown';
};

const program = new Command();

program
  .name('wechat-pub')
  .description('A CLI tool to sync Markdown blog posts to WeChat Official Account Draft Box')
  .version(getVersion())
  .addHelpText('after', `
Example Usage:
  $ wechat-pub init
  $ wechat-pub init --draft newspic --output ./wechat-drafts/my-gallery
  $ wechat-pub sync _posts/2024-03-06-hello.md
  $ wechat-pub latest 5 --force
  $ wechat-pub list 10
  $ wechat-pub publish-dir ./wechat-drafts/my-draft
  `);

program
  .command('init')
  .description('Initialize project configuration or a news/newspic draft directory')
  .option('--draft <type>', 'Create a draft template of type news or newspic')
  .option('-o, --output <dir>', 'Output directory for the draft template')
  .option('--title <title>', 'Draft title')
  .option('--author <author>', 'Draft author')
  .option('--content <content>', 'Draft HTML or image-post caption')
  .option('--digest <digest>', 'Optional news summary')
  .option('--cover <file>', 'News cover image relative to the output directory')
  .option('--images <files...>', 'Newspic image files relative to the output directory, in order')
  .option('--open-comment', 'Enable comments')
  .option('--fans-only-comment', 'Allow comments from fans only')
  .option('-f, --force', 'Overwrite an existing draft.json')
  .option('-c, --config <path>', 'Configuration used to resolve the default author', 'wechat.config.yml')
  .action(async options => {
    try {
      await initCommand({
        ...options,
        needOpenComment: options.openComment,
        onlyFansCanComment: options.fansOnlyComment,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Error: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command('latest [count]')
  .description('Sync the latest N posts sorted by filename date')
  .option('-f, --force', 'Force sync and overwrite if duplicate exists')
  .option('-d, --dry-run', 'Perform all local steps but don\'t call WeChat API')
  .option('-c, --config <path>', 'Path to a custom configuration file', 'wechat.config.yml')
  .action(async (count, options) => {
    await latestCommand(count, options);
  });

program
  .command('sync <post-path>')
  .description('Sync a specific Markdown post to WeChat draft box')
  .option('-f, --force', 'Force sync and overwrite if duplicate exists')
  .option('-d, --dry-run', 'Perform all local steps but don\'t call WeChat API')
  .option('-c, --config <path>', 'Path to a custom configuration file', 'wechat.config.yml')
  .action(async (postPath, options) => {
    await syncCommand(postPath, options);
  });

program
  .command('list [count]')
  .description('List recent drafts from WeChat Official Account')
  .option('-c, --config <path>', 'Path to a custom configuration file', 'wechat.config.yml')
  .action(async (count, options) => {
    await listCommand(count, options);
  });

program
  .command('publish-dir <dir>')
  .description('Publish a draft payload directory (one JSON + local images) to WeChat draft box')
  .option('-d, --dry-run', 'Resolve placeholders and validate only; do not call WeChat API')
  .option('-c, --config <path>', 'Path to a custom configuration file', 'wechat.config.yml')
  .action(async (dir, options) => {
    await publishDirCommand(dir, options);
  });

program.parse(process.argv);
