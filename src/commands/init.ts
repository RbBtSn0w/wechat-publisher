import fs from 'fs';
import path from 'path';
import readline from 'readline';
import yaml from 'yaml';
import {
  completeDraftInitOptions,
  initializeDraftDirectory,
  PartialDraftInitOptions,
} from '../lib/draft-initializer';

type InitOptions = PartialDraftInitOptions & {
  config?: string;
};

function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

function loadConfiguredAuthor(configPath = 'wechat.config.yml'): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), configPath),
    path.resolve(process.cwd(), '.wechat.yml'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const contents = yaml.parse(fs.readFileSync(candidate, 'utf8'));
    if (typeof contents?.author === 'string' && contents.author.trim()) {
      return contents.author.trim();
    }
  }
  return undefined;
}

function initProjectConfig() {
  const configPath = path.resolve(process.cwd(), 'wechat.config.yml');
  const envPath = path.resolve(process.cwd(), '.env');
  
  if (fs.existsSync(configPath)) {
    console.log('⚠️ wechat.config.yml already exists in current directory.');
    return;
  }

  const template = {
    author: "Your Name",
    siteUrl: "https://your-blog.com",
    postsDir: "_posts",
    assetsDir: "assets",
    style: "default"
  };

  fs.writeFileSync(configPath, yaml.stringify(template), 'utf8');
  console.log('✅ Created wechat.config.yml for public settings.');

  if (!fs.existsSync(envPath)) {
    const envTemplate = 'WECHAT_APP_ID=YOUR_APP_ID\nWECHAT_APP_SECRET=YOUR_APP_SECRET\n';
    fs.writeFileSync(envPath, envTemplate, 'utf8');
    console.log('✅ Created .env template for secrets.');
  } else {
    console.log('⚠️ .env already exists, please make sure WECHAT_APP_ID and WECHAT_APP_SECRET are set.');
  }

  // Attempt to add .env to .gitignore automatically
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignoreContent.includes('.env')) {
      fs.appendFileSync(gitignorePath, '\n# Environment Variables\n.env\n', 'utf8');
      console.log('✅ Added .env to .gitignore.');
    }
  }

  console.log('Next steps:');
  console.log('1. Fill in WECHAT_APP_ID and WECHAT_APP_SECRET in the .env file.');
  console.log('2. Commit wechat.config.yml to your repository, but NEVER commit .env.');
}

export async function initCommand(options: InitOptions = {}) {
  if (!options.draft) {
    initProjectConfig();
    return;
  }

  const completed = await completeDraftInitOptions(options, {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: promptUser,
    defaultAuthor: loadConfiguredAuthor(options.config),
  });
  const result = initializeDraftDirectory(completed);

  console.log(`✅ Created ${completed.draft} draft template: ${result.payloadPath}`);
  console.log(`Images: ${result.imageFiles.length}`);
  console.log('Next steps:');
  console.log(`1. Validate: wechat-pub publish-dir "${result.outputDirectory}" --dry-run`);
  console.log(`2. Publish: wechat-pub publish-dir "${result.outputDirectory}"`);
}
