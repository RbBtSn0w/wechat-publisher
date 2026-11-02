import { spawn } from 'child_process';

export interface ClipboardResult {
  success: boolean;
  platform: string;
  error?: string;
}

/**
 * Copies inline HTML into the system clipboard as rich text (HTML format).
 * On macOS (Darwin), uses AppleScript/osascript via stdin with hex-encoded data
 * to register the content directly under the 'public.html' clipboard pasteboard type
 * without hitting OS argv/ARG_MAX limits.
 */
export async function copyRichTextToClipboard(html: string): Promise<ClipboardResult> {
  const platform = process.platform;

  if (!html || html.trim().length === 0) {
    return {
      success: false,
      platform,
      error: 'Empty HTML content cannot be copied to clipboard.',
    };
  }

  if (platform === 'darwin') {
    return new Promise(resolve => {
      const hex = Buffer.from(html, 'utf8').toString('hex');
      const script = `set the clipboard to «data HTML${hex}»\n`;

      const child = spawn('osascript', ['-']);

      let stderr = '';
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      child.on('close', code => {
        if (code === 0) {
          resolve({ success: true, platform });
        } else {
          resolve({
            success: false,
            platform,
            error: stderr.trim() || `osascript exited with code ${code}`,
          });
        }
      });

      child.on('error', err => {
        resolve({
          success: false,
          platform,
          error: err.message,
        });
      });

      child.stdin.on('error', () => {
        // Ignore broken pipe if child exits early; 'close' handler will report status
      });
      child.stdin.write(script);
      child.stdin.end();
    });
  }

  // Fallback for non-macOS systems
  return {
    success: false,
    platform,
    error: `Direct rich-text clipboard injection is not yet natively supported on ${platform}. Please use --output to export an HTML file.`,
  };
}
