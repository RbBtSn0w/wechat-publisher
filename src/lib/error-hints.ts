const IP_WHITELIST_URL =
  'https://developers.weixin.qq.com/console/product/mp/wx1ef3c52fafa09019?tab1=basicInfo&tab2=dev';

interface ErrorHint {
  /** Keywords to match against the error message (case-insensitive). */
  patterns: RegExp[];
  /** The hint message to display when matched. */
  hint: string;
}

const ERROR_HINTS: ErrorHint[] = [
  {
    patterns: [
      /ip\s/i,
      /\b40164\b/,
      /invalid\s*ip/i,
      /not\s*in\s*whitelist/i,
      /white\s*list/i,
    ],
    hint: `💡 如果是 IP 地址问题，请访问微信公众平台后台的「IP白名单」更新 IP 地址：\n   ${IP_WHITELIST_URL}`,
  },
];

/**
 * Builds a formatted error output string with contextual hints.
 *
 * Scans the error message against known patterns and appends helpful
 * remediation hints when a match is found.
 */
export function formatErrorWithHints(message: string): string {
  const lines: string[] = [`\n❌ Error: ${message}`];

  for (const { patterns, hint } of ERROR_HINTS) {
    if (patterns.some((p) => p.test(message))) {
      lines.push('');
      lines.push(hint);
    }
  }

  return lines.join('\n');
}
