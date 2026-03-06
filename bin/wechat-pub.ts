#!/usr/bin/env node

import { Command } from 'commander';
import { syncCommand } from '../src/commands/sync';
import { listCommand } from '../src/commands/list';

const program = new Command();

program
  .name('wechat-pub')
  .description('CLI to sync Jekyll posts to WeChat Official Account Draft Box')
  .version('1.0.0');

program
  .command('sync <post-path>')
  .description('Sync a specific post to WeChat draft box')
  .option('-f, --force', 'Skip duplicate checking and create a new draft anyway')
  .option('-d, --dry-run', 'Perform all local steps but don\'t call WeChat API')
  .option('-c, --config <path>', 'Path to a custom configuration file', '.wechat.yml')
  .action(async (postPath, options) => {
    await syncCommand(postPath, options);
  });

program
  .command('list [count]')
  .description('List recent drafts from WeChat')
  .option('-c, --config <path>', 'Path to a custom configuration file', '.wechat.yml')
  .action(async (count, options) => {
    await listCommand(count, options);
  });

program.parse(process.argv);
