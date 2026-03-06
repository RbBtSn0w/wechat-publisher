import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

export function initCommand() {
  const configPath = path.resolve(process.cwd(), '.wechat.yml');
  
  if (fs.existsSync(configPath)) {
    console.log('⚠️ .wechat.yml already exists in current directory.');
    return;
  }

  const template = {
    appId: "YOUR_APP_ID",
    appSecret: "YOUR_APP_SECRET",
    author: "Your Name",
    siteUrl: "https://your-blog.com",
    postsDir: "_posts",
    assetsDir: "assets",
    style: "default"
  };

  fs.writeFileSync(configPath, yaml.stringify(template), 'utf8');
  console.log('✅ Created .wechat.yml template in current directory.');
  console.log('Next steps:');
  console.log('1. Fill in your appId and appSecret.');
  console.log('2. Add .wechat.yml to your .gitignore.');
}
