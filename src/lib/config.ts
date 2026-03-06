import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export function loadConfig(configPath = '.wechat.yml'): AppConfig {
  let fullPath = path.resolve(process.cwd(), configPath);
  
  // Fallback to sub-project directory if not found in CWD and using default path
  if (!fs.existsSync(fullPath) && configPath === '.wechat.yml') {
    const subProjectPath = path.resolve(process.cwd(), 'wechat-publisher', '.wechat.yml');
    if (fs.existsSync(subProjectPath)) {
      fullPath = subProjectPath;
    }
  }

  let ymlConfig: Partial<AppConfig> = {};
  
  if (fs.existsSync(fullPath)) {
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    ymlConfig = yaml.parse(fileContents) || {};
  } else {
    // If we still don't have a file, and we are not using environment variables, this will fail below
  }

  const appId = process.env.APP_ID || ymlConfig.appId;
  const appSecret = process.env.APP_SECRET || ymlConfig.appSecret;

  if (!appId || !appSecret) {
    throw new Error('Missing WeChat AppID or AppSecret in environment or config file.');
  }

  return {
    appId,
    appSecret,
    baseUrl: ymlConfig.baseUrl || 'https://api.weixin.qq.com',
    siteUrl: ymlConfig.siteUrl || '',
    postsDir: ymlConfig.postsDir || '_posts',
    assetsDir: ymlConfig.assetsDir || 'assets/img/post',
    author: ymlConfig.author || '',
    style: ymlConfig.style || 'default',
  };
}
