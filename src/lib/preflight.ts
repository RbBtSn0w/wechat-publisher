import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { maskProtectedRegions, SourceScanOptions } from './source-regions';

export interface PreflightIssue {
  severity: 'error' | 'warning';
  message: string;
  field?: string;
  line?: number;
}

export interface PreflightResult {
  passed: boolean;
  issues: PreflightIssue[];
}

export function validatePlaceholderText(content: string, options: SourceScanOptions = {}): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const lines = maskProtectedRegions(content, options).split(/\r?\n/);

  const errorPatterns: { pattern: RegExp; desc: string }[] = [
    { pattern: /\[TODO(?:[:\s][^\]]*)?\]/i, desc: 'Unresolved [TODO] placeholder' },
    { pattern: /【待补充[^】]*】/i, desc: 'Unresolved 【待补充】 placeholder' },
    { pattern: /local:\/\/[^\s'")<>]+/i, desc: 'Unresolved raw local:// image placeholder' },
  ];

  const warningPatterns: { pattern: RegExp; desc: string }[] = [
    { pattern: /\bFIXME\b/i, desc: 'FIXME notice present' },
    { pattern: /\[TBD\]/i, desc: 'TBD placeholder' },
  ];

  lines.forEach((visibleProse, idx) => {
    const lineNum = idx + 1;

    for (const { pattern, desc } of errorPatterns) {
      if (pattern.test(visibleProse)) {
        issues.push({
          severity: 'error',
          line: lineNum,
          message: `${desc} at line ${lineNum}`,
        });
      }
    }
    for (const { pattern, desc } of warningPatterns) {
      if (pattern.test(visibleProse)) {
        issues.push({
          severity: 'warning',
          line: lineNum,
          message: `${desc} at line ${lineNum}`,
        });
      }
    }
  });

  return issues;
}

export async function validateCoverImage(coverPath: string): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const resolvedPath = path.resolve(coverPath);

  if (!fs.existsSync(resolvedPath)) {
    return [
      {
        severity: 'error',
        field: 'cover',
        message: `Cover image not found: ${resolvedPath}`,
      },
    ];
  }

  try {
    const meta = await sharp(resolvedPath).metadata();
    if (!meta.width || !meta.height) {
      return [
        {
          severity: 'error',
          field: 'cover',
          message: `Unable to read dimensions from cover image: ${resolvedPath}`,
        },
      ];
    }

    const ratio = meta.width / meta.height;
    const targetRatio = 2.35; // standard WeChat 2.35:1 (e.g. 940x400 or 1200x510)
    const diff = Math.abs(ratio - targetRatio);

    // Allow a small delta tolerance (0.05)
    if (diff > 0.05) {
      const actualRatioStr = ratio.toFixed(2);
      issues.push({
        severity: diff > 0.3 ? 'error' : 'warning',
        field: 'cover',
        message: `Cover aspect ratio mismatch (${meta.width}x${meta.height}, ratio: ${actualRatioStr}:1). WeChat requires 2.35:1 (e.g. 940x400 or 1200x510).`,
      });
    }

    // Check file size (> 2MB warning)
    const stats = fs.statSync(resolvedPath);
    if (stats.size > 2 * 1024 * 1024) {
      issues.push({
        severity: 'warning',
        field: 'cover',
        message: `Cover image size (${(stats.size / 1024 / 1024).toFixed(1)}MB) exceeds recommended 2MB limit.`,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push({
      severity: 'error',
      field: 'cover',
      message: `Failed to inspect cover image: ${msg}`,
    });
  }

  return issues;
}

export async function runPreflightCheck(options: {
  content: string;
  coverPath?: string;
  strict?: boolean;
  markdownInline?: boolean;
}): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  // 1. Text placeholders check
  issues.push(...validatePlaceholderText(options.content, { markdownInline: options.markdownInline }));

  // 2. Cover image check
  if (options.coverPath) {
    const coverIssues = await validateCoverImage(options.coverPath);
    issues.push(...coverIssues);
  }

  const hasError = issues.some(i => i.severity === 'error');
  const hasWarning = issues.some(i => i.severity === 'warning');

  const passed = options.strict ? !hasError && !hasWarning : !hasError;

  return {
    passed,
    issues,
  };
}
