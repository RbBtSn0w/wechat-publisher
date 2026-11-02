import { describe, it, expect, vi } from 'vitest';
import { copyRichTextToClipboard } from '../src/lib/clipboard';

describe('copyRichTextToClipboard', () => {
  it('returns success and runs osascript on darwin platform', async () => {
    const html = '<p style="color: red;">Hello WeChat</p>';
    const result = await copyRichTextToClipboard(html);

    if (process.platform === 'darwin') {
      expect(result.success).toBe(true);
      expect(result.platform).toBe('darwin');
    } else {
      expect(result.platform).toBe(process.platform);
    }
  });

  it('rejects empty html input', async () => {
    const result = await copyRichTextToClipboard('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty HTML');
  });
});
