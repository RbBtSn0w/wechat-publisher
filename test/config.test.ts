import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/lib/config';

describe('loadConfig credential mismatch warnings', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    delete process.env.APP_ID;
    delete process.env.APP_SECRET;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-config-test-'));
    configPath = path.join(tempDir, '.wechat.yml');
    fs.writeFileSync(
      configPath,
      'appId: yml_appid\nappSecret: yml_secret\n',
      'utf8'
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('warns naming APP_SECRET when APP_SECRET conflicts with config file', () => {
    delete process.env.WECHAT_APP_SECRET;
    process.env.APP_SECRET = 'env_secret';
    process.env.APP_ID = 'yml_appid';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig(configPath);

    expect(cfg.appSecret).toBe('env_secret');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('APP_SECRET from environment variable differs');
    expect(warnSpy.mock.calls[0][0]).not.toContain('WECHAT_APP_SECRET');
  });

  it('warns naming WECHAT_APP_SECRET when WECHAT_APP_SECRET conflicts with config file', () => {
    process.env.WECHAT_APP_SECRET = 'env_wechat_secret';
    delete process.env.APP_SECRET;
    process.env.WECHAT_APP_ID = 'yml_appid';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig(configPath);

    expect(cfg.appSecret).toBe('env_wechat_secret');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('WECHAT_APP_SECRET from environment variable differs');
  });
});
