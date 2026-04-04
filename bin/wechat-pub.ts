#!/usr/bin/env node

import { Command } from 'commander';
import { syncCommand } from '../src/commands/sync';
import { listCommand } from '../src/commands/list';
import { initCommand } from '../src/commands/init';
import { latestCommand } from '../src/commands/latest';
import { publishDirCommand } from '../src/commands/publish-dir';

const program = new Command();

program
  .name('wechat-pub')
  .description('A CLI tool to sync Markdown blog posts to WeChat Official Account Draft Box')
  .version('1.0.0')
  .addHelpText('after', `
Example Usage:
  $ wechat-pub init
  $ wechat-pub sync _posts/2024-03-06-hello.md
  $ wechat-pub latest 5 --force
  $ wechat-pub list 10
  $ wechat-pub publish-dir ./wechat-drafts/my-draft
  `);

program
  .command('init')
  .description('Initialize a new wechat.config.yml configuration template in the current directory')
  .action(() => {
    initCommand();
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
