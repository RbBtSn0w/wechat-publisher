import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

export function initCommand() {
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
