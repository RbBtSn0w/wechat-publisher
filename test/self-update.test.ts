import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import {
  PACKAGE_NAME,
  resolveSelfUpdateTarget,
  selfUpdateCommand,
  selfUpdateSpawnOptions,
  formatSelfUpdateStart,
  formatSelfUpdateResult,
  selfUpdateFailureHint,
  selfUpdateHint,
  prereleaseChannel,
} from '../src/lib/self-update';
import { updateCommand, getInstalledVersion } from '../src/commands/update';

describe('self-update lib', () => {
  it('has the expected package name', () => {
    expect(PACKAGE_NAME).toBe('@rbbtsn0w/wechat-publisher');
  });

  describe('prereleaseChannel', () => {
    it('extracts prerelease channel names correctly', () => {
      expect(prereleaseChannel('1.2.3')).toBeUndefined();
      expect(prereleaseChannel('1.2.3-beta.1')).toBe('beta');
      expect(prereleaseChannel('1.2.3-next.0')).toBe('next');
      expect(prereleaseChannel('1.2.3-alpha.5')).toBe('alpha');
      expect(prereleaseChannel('1.2.3-dev.2024')).toBe('dev');
    });
  });

  describe('resolveSelfUpdateTarget', () => {
    it('defaults to latest when no flags provided', () => {
      expect(resolveSelfUpdateTarget({})).toBe('latest');
      expect(resolveSelfUpdateTarget()).toBe('latest');
    });

    it('resolves beta flag to beta', () => {
      expect(resolveSelfUpdateTarget({ beta: true })).toBe('beta');
    });

    it('resolves dev flag to next', () => {
      expect(resolveSelfUpdateTarget({ dev: true })).toBe('next');
    });

    it('resolves custom tag when specified', () => {
      expect(resolveSelfUpdateTarget({ tag: 'canary' })).toBe('canary');
      expect(resolveSelfUpdateTarget({ tag: '1.2.0' })).toBe('1.2.0');
    });

    it('prioritizes explicit tag over beta and dev', () => {
      expect(resolveSelfUpdateTarget({ tag: 'rc.1', beta: true, dev: true })).toBe('rc.1');
    });
  });

  describe('selfUpdateCommand', () => {
    it('constructs default npm install invocation for latest', () => {
      expect(selfUpdateCommand('latest')).toEqual({
        command: 'npm',
        args: ['install', '-g', '@rbbtsn0w/wechat-publisher@latest'],
      });
    });

    it('constructs npm install invocation for beta and custom npm binary', () => {
      expect(selfUpdateCommand('beta', '/usr/local/bin/npm')).toEqual({
        command: '/usr/local/bin/npm',
        args: ['install', '-g', '@rbbtsn0w/wechat-publisher@beta'],
      });
    });
  });

  describe('selfUpdateSpawnOptions', () => {
    it('enables shell on win32 only', () => {
      expect(selfUpdateSpawnOptions('win32')).toEqual({ stdio: 'inherit', shell: true });
      expect(selfUpdateSpawnOptions('darwin')).toEqual({ stdio: 'inherit', shell: false });
      expect(selfUpdateSpawnOptions('linux')).toEqual({ stdio: 'inherit', shell: false });
    });
  });

  describe('formatSelfUpdateStart', () => {
    it('formats start message accurately', () => {
      const msg = formatSelfUpdateStart('1.2.1', 'beta');
      expect(msg).toContain('wechat-pub 1.2.1 → installing beta');
      expect(msg).toContain('npm install -g @rbbtsn0w/wechat-publisher@beta');
    });
  });

  describe('formatSelfUpdateResult', () => {
    it('formats success result with elapsed seconds', () => {
      expect(formatSelfUpdateResult(true, 2500)).toBe(
        'updated · 2.5s — run `wechat-pub --version` to confirm'
      );
    });

    it('formats failure result with elapsed seconds', () => {
      expect(formatSelfUpdateResult(false, 1200)).toBe('update failed · 1.2s');
    });
  });

  describe('selfUpdateFailureHint', () => {
    it('includes direct command hint and EACCES permission hint', () => {
      const hint = selfUpdateFailureHint('next');
      expect(hint).toContain('try running it directly: npm install -g @rbbtsn0w/wechat-publisher@next');
      expect(hint).toContain('EACCES');
    });
  });

  describe('selfUpdateHint', () => {
    it('maps version notices to appropriate wechat-pub update commands', () => {
      expect(selfUpdateHint('1.2.3')).toBe('wechat-pub update');
      expect(selfUpdateHint('1.3.0-beta.1')).toBe('wechat-pub update --beta');
      expect(selfUpdateHint('1.3.0-next.0')).toBe('wechat-pub update --dev');
      expect(selfUpdateHint('1.3.0-dev.1')).toBe('wechat-pub update --dev');
      expect(selfUpdateHint('1.3.0-alpha.2')).toBe('wechat-pub update --dev');
      expect(selfUpdateHint('1.3.0-preview.1')).toBe('npm install -g @rbbtsn0w/wechat-publisher@1.3.0-preview.1');
    });
  });
});

describe('updateCommand handler', () => {
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles dry-run mode without spawning child process', async () => {
    const mockRunner = vi.fn();

    await updateCommand({ dryRun: true, beta: true }, '1.2.1', mockRunner);

    expect(mockRunner).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would execute: npm install -g @rbbtsn0w/wechat-publisher@beta')
    );
    expect(logSpy).toHaveBeenCalledWith('Target channel / version: beta');
  });

  it('handles dev dry-run', async () => {
    await updateCommand({ dryRun: true, dev: true }, '1.2.1');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would execute: npm install -g @rbbtsn0w/wechat-publisher@next')
    );
  });

  it('handles specific tag dry-run', async () => {
    await updateCommand({ dryRun: true, tag: 'canary' }, '1.2.1');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] Would execute: npm install -g @rbbtsn0w/wechat-publisher@canary')
    );
  });

  it('runs runner successfully when dryRun is false', async () => {
    const mockRunner = vi.fn().mockReturnValue({ status: 0 });

    await updateCommand({ beta: true }, '1.2.1', mockRunner);

    expect(mockRunner).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', '@rbbtsn0w/wechat-publisher@beta'],
      expect.objectContaining({ stdio: 'inherit' })
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('wechat-pub 1.2.1 → installing beta')
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('updated ·')
    );
  });

  it('throws error when runner returns non-zero status', async () => {
    const mockRunner = vi.fn().mockReturnValue({ status: 1 });

    await expect(updateCommand({ beta: true }, '1.2.1', mockRunner)).rejects.toThrow(
      'Self-update failed with exit code 1'
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('update failed ·'));
  });

  it('throws error when runner encounters an execution error', async () => {
    const mockRunner = vi.fn().mockReturnValue({
      error: new Error('ENOENT: npm not found'),
      status: null,
    });

    await expect(updateCommand({}, '1.2.1', mockRunner)).rejects.toThrow(
      'Self-update failed: ENOENT: npm not found'
    );
  });

  it('getInstalledVersion returns a version string', () => {
    const ver = getInstalledVersion();
    expect(typeof ver).toBe('string');
    expect(ver.length).toBeGreaterThan(0);
  });
});
