import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export function loadConfig(
  configPath = 'wechat.config.yml',
  options: { requireCredentials?: boolean } = {}
): AppConfig {
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

  const envSecretKey = process.env.WECHAT_APP_SECRET ? 'WECHAT_APP_SECRET' : process.env.APP_SECRET ? 'APP_SECRET' : undefined;
  const envSecret = envSecretKey ? process.env[envSecretKey] : undefined;
  if (envSecret && ymlConfig.appSecret && envSecret !== ymlConfig.appSecret) {
    console.warn(
      `⚠️ Notice: ${envSecretKey} from environment variable differs from config file (` +
        path.basename(fullPath) +
        ') and will take precedence. If you recently updated the config file, update or unset your environment variable.'
    );
  }

  const envIdKey = process.env.WECHAT_APP_ID ? 'WECHAT_APP_ID' : process.env.APP_ID ? 'APP_ID' : undefined;
  const envId = envIdKey ? process.env[envIdKey] : undefined;
  if (envId && ymlConfig.appId && envId !== ymlConfig.appId) {
    console.warn(
      `⚠️ Notice: ${envIdKey} from environment variable differs from config file (` +
        path.basename(fullPath) +
        ') and will take precedence. If you recently updated the config file, update or unset your environment variable.'
    );
  }

  const appId = envId || ymlConfig.appId;
  const appSecret = envSecret || ymlConfig.appSecret;

  if (options.requireCredentials !== false && (!appId || !appSecret)) {
    throw new Error('Missing WeChat AppID or AppSecret. Please set WECHAT_APP_ID and WECHAT_APP_SECRET in your .env file or environment variables.');
  }

  return {
    appId: appId || '',
    appSecret: appSecret || '',
    baseUrl: ymlConfig.baseUrl || 'https://api.weixin.qq.com',
    siteUrl: ymlConfig.siteUrl || '',
    postsDir: ymlConfig.postsDir || '_posts',
    assetsDir: ymlConfig.assetsDir || 'assets',
    author: ymlConfig.author || '',
    style: ymlConfig.style || 'default',
    limits: ymlConfig.limits,
    requestTimeoutMs: ymlConfig.requestTimeoutMs || 15_000,
    maxRetries: ymlConfig.maxRetries ?? 3,
  };
}
