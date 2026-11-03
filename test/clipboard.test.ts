import { describe, it, expect, vi, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { copyRichTextToClipboard } from '../src/lib/clipboard';

describe('copyRichTextToClipboard', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.clearAllMocks();
  });

  it('runs osascript via stdin and succeeds on darwin platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    let capturedScript = '';
    const fakeChild = new EventEmitter() as any;
    fakeChild.stdin = {
      on: vi.fn(),
      write: vi.fn((chunk: string) => {
        capturedScript += chunk;
      }),
      end: vi.fn(() => {
        process.nextTick(() => fakeChild.emit('close', 0));
      }),
    };
    fakeChild.stderr = new EventEmitter();

    vi.mocked(childProcess.spawn).mockReturnValue(fakeChild);

    const html = '<p style="color: red;">Hello WeChat</p>';
    const result = await copyRichTextToClipboard(html);

    expect(result.success).toBe(true);
    expect(result.platform).toBe('darwin');
    expect(childProcess.spawn).toHaveBeenCalledWith('osascript', ['-']);
    expect(capturedScript).toContain('set the clipboard to «data HTML');
  });

  it('returns failure when osascript exits with non-zero code on darwin', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const fakeChild = new EventEmitter() as any;
    fakeChild.stdin = {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(() => {
        process.nextTick(() => {
          fakeChild.stderr.emit('data', Buffer.from('AppleScript execution failed'));
          fakeChild.emit('close', 1);
        });
      }),
    };
    fakeChild.stderr = new EventEmitter();

    vi.mocked(childProcess.spawn).mockReturnValue(fakeChild);

    const result = await copyRichTextToClipboard('<p>Test</p>');
    expect(result.success).toBe(false);
    expect(result.error).toContain('AppleScript execution failed');
  });

  it('returns unsupported failure on non-darwin platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const result = await copyRichTextToClipboard('<p>Test</p>');
    expect(result.success).toBe(false);
    expect(result.platform).toBe('linux');
    expect(result.error).toContain('not yet natively supported');
  });

  it('rejects empty html input', async () => {
    const result = await copyRichTextToClipboard('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty HTML');
  });
});
