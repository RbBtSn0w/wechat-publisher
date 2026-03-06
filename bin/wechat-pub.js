#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const sync_1 = require("../src/commands/sync");
const program = new commander_1.Command();
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
    await (0, sync_1.syncCommand)(postPath, options);
});
program
    .command('list [count]')
    .description('List recent drafts from WeChat')
    .action((count) => {
    console.log(`Listing ${count || 10} drafts`);
    // TODO: Implement list logic
});
program.parse(process.argv);
