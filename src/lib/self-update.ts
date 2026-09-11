export const PACKAGE_NAME = '@rbbtsn0w/wechat-publisher';

export interface SelfUpdateOptions {
  beta?: boolean;
  dev?: boolean;
  tag?: string;
  dryRun?: boolean;
  npmBin?: string;
}

export function prereleaseChannel(version: string): string | undefined {
  const match = version.match(/-([0-9A-Za-z.-]+)$/);
  if (!match) return undefined;
  const tag = match[1].split('.')[0];
  return tag.toLowerCase();
}

export function resolveSelfUpdateTarget(options: SelfUpdateOptions = {}): string {
  if (options.tag && options.tag.trim().length > 0) {
    return options.tag.trim();
  }
  if (options.dev) {
    return 'next';
  }
  if (options.beta) {
    return 'beta';
  }
  return 'latest';
}

export function selfUpdateCommand(
  target: string,
  npmBin = 'npm'
): { command: string; args: string[] } {
  return {
    command: npmBin,
    args: ['install', '-g', `${PACKAGE_NAME}@${target}`],
  };
}

export function selfUpdateSpawnOptions(
  platform: NodeJS.Platform = process.platform
): { stdio: 'inherit'; shell: boolean } {
  return {
    stdio: 'inherit',
    shell: platform === 'win32',
  };
}

export function formatSelfUpdateStart(
  currentVersion: string,
  target: string,
  npmBin = 'npm'
): string {
  const { command, args } = selfUpdateCommand(target, npmBin);
  return `wechat-pub ${currentVersion} → installing ${target} (${command} ${args.join(' ')})`;
}

export function formatSelfUpdateResult(ok: boolean, elapsedMs: number): string {
  const seconds = `${(elapsedMs / 1000).toFixed(1)}s`;
  return ok
    ? `updated · ${seconds} — run \`wechat-pub --version\` to confirm`
    : `update failed · ${seconds}`;
}

export function selfUpdateFailureHint(target: string, npmBin = 'npm'): string {
  const { command, args } = selfUpdateCommand(target, npmBin);
  return (
    `try running it directly: ${command} ${args.join(' ')}\n` +
    `if that fails with EACCES, npm's global prefix needs write access (or install via a version manager).`
  );
}

export function selfUpdateHint(latestVersion: string): string {
  const channel = prereleaseChannel(latestVersion);
  if (channel === 'beta') return 'wechat-pub update --beta';
  if (channel === 'next' || channel === 'dev' || channel === 'alpha' || channel === 'canary') {
    return 'wechat-pub update --dev';
  }
  if (channel) return `npm install -g ${PACKAGE_NAME}@${latestVersion}`;
  return 'wechat-pub update';
}
