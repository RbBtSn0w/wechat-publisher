import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { decodeHtmlEntities } from './converter';
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

const errorPatterns: { pattern: RegExp; desc: string; local?: boolean }[] = [
  { pattern: /\[TODO(?:[:\s][^\]]*)?\]/i, desc: 'Unresolved [TODO] placeholder' },
  { pattern: /【待补充[^】]*】/i, desc: 'Unresolved 【待补充】 placeholder' },
  { pattern: /local:\/\/[^\s'")<>]+/i, desc: 'Unresolved raw local:// image placeholder', local: true },
];

const warningPatterns: { pattern: RegExp; desc: string }[] = [
  { pattern: /\bFIXME\b/i, desc: 'FIXME notice present' },
  { pattern: /\[TBD\]/i, desc: 'TBD placeholder' },
];

export function validatePlaceholderText(content: string, options: SourceScanOptions = {}): PreflightIssue[] {
  return scanPlaceholderText(content, options);
}

function decodePlaceholderEntities(content: string): string {
  // One pass avoids turning literal &amp;#91; text into a bracket placeholder.
  const brackets: Record<string, string> = { lsqb: '[', lbrack: '[', rsqb: ']', rbrack: ']' };
  return content.replace(/&(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|#39|lsqb|lbrack|rsqb|rbrack);/gi, entity => {
    const token = entity.slice(1, -1).toLowerCase();
    if (token.startsWith('#')) {
      const codepoint = token.startsWith('#x') ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
      return codepoint <= 0x10ffff ? String.fromCodePoint(codepoint) : entity;
    }
    return brackets[token] ?? decodeHtmlEntities(entity);
  });
}

function scanPlaceholderText(content: string, options: SourceScanOptions, kind: 'all' | 'text' = 'all', checks: { decodeEntities?: boolean; seen?: Map<string, number>; exclude?: Map<string, number> } = {}): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const visible = maskProtectedRegions(content, options);
  const lines = (checks.decodeEntities ? decodePlaceholderEntities(visible) : visible).split(/\r?\n/);
  lines.forEach((visibleProse, idx) => {
    const lineNum = idx + 1;
    const context = visibleProse.replace(/<[^>]*>/g, '').trim();
    for (const rule of [...errorPatterns.map(rule => ({ ...rule, severity: 'error' as const })),
      ...warningPatterns.map(rule => ({ ...rule, local: false, severity: 'warning' as const }))]) {
      if (kind === 'text' && rule.local) continue;
      for (const match of visibleProse.matchAll(new RegExp(rule.pattern.source, 'gi'))) {
        // Deduplicate only matching occurrences on an unchanged visible line.
        // Rendering may erase one source placeholder while revealing another.
        const identity = JSON.stringify([lineNum, match[0], context]);
        const remaining = checks.exclude?.get(identity) || 0;
        if (remaining) { checks.exclude!.set(identity, remaining - 1); continue; }
        checks.seen?.set(identity, (checks.seen.get(identity) || 0) + 1);
        issues.push({ severity: rule.severity, line: lineNum, message: `${rule.desc} at line ${lineNum}` });
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
  sourceMarkdown?: string;
  coverPath?: string;
  strict?: boolean;
  markdownInline?: boolean;
}): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  // 1. Text placeholders check
  if (options.sourceMarkdown !== undefined) {
    // Rendering can remove placeholder syntax from link labels; media must be checked after resolution.
    const sourceRules = new Map<string, number>();
    issues.push(...scanPlaceholderText(options.sourceMarkdown, {}, 'text', { seen: sourceRules }));
    issues.push(...scanPlaceholderText(options.content, { markdownInline: false }, 'all', { decodeEntities: true, exclude: sourceRules }));
  } else {
    issues.push(...scanPlaceholderText(options.content, { markdownInline: options.markdownInline }, 'all', { decodeEntities: true }));
  }

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
