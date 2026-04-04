import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export function loadConfig(configPath = 'wechat.config.yml'): AppConfig {
  let fullPath = path.resolve(process.cwd(), configPath);
  
  // Backward compatibility with older default name
  if (!fs.existsSync(fullPath) && configPath === 'wechat.config.yml') {
    const legacyPath = path.resolve(process.cwd(), '.wechat.yml');
    if (fs.existsSync(legacyPath)) {
      fullPath = legacyPath;
    } else {
      const subProjectPath = path.resolve(process.cwd(), 'wechat-publisher', '.wechat.yml');
      if (fs.existsSync(subProjectPath)) {
        fullPath = subProjectPath;
      }
    }
  }

  let ymlConfig: Partial<AppConfig> = {};
  
  if (fs.existsSync(fullPath)) {
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    ymlConfig = yaml.parse(fileContents) || {};
  }

  const appId = process.env.WECHAT_APP_ID || process.env.APP_ID || ymlConfig.appId;
  const appSecret = process.env.WECHAT_APP_SECRET || process.env.APP_SECRET || ymlConfig.appSecret;

  if (!appId || !appSecret) {
    throw new Error('Missing WeChat AppID or AppSecret. Please set WECHAT_APP_ID and WECHAT_APP_SECRET in your .env file or environment variables.');
  }

  return {
    appId,
    appSecret,
    baseUrl: ymlConfig.baseUrl || 'https://api.weixin.qq.com',
    siteUrl: ymlConfig.siteUrl || '',
    postsDir: ymlConfig.postsDir || '_posts',
    assetsDir: ymlConfig.assetsDir || 'assets',
    author: ymlConfig.author || '',
    style: ymlConfig.style || 'default',
  };
}
