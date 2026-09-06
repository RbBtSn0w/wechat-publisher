import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  SelfUpdateOptions,
  resolveSelfUpdateTarget,
  selfUpdateCommand,
  selfUpdateSpawnOptions,
  formatSelfUpdateStart,
  formatSelfUpdateResult,
  selfUpdateFailureHint,
} from '../lib/self-update';

export function getInstalledVersion(): string {
  const pkgPaths = [
    path.join(__dirname, '../../package.json'), // from dist/src/commands
    path.join(__dirname, '../package.json'),    // from src/commands
    path.join(__dirname, '../../../package.json'),
  ];
  for (const p of pkgPaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8')).version || 'unknown';
      } catch {
        // ignore and try next path
      }
    }
  }
  return 'unknown';
}

export type SubprocessRunner = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; shell: boolean }
) => { status: number | null; error?: Error };

export async function updateCommand(
  options: SelfUpdateOptions = {},
  currentVersion?: string,
  runner: SubprocessRunner = spawnSync
): Promise<void> {
  const version = currentVersion || getInstalledVersion();
  const target = resolveSelfUpdateTarget(options);
  const cmd = selfUpdateCommand(target, options.npmBin);

  if (options.dryRun) {
    console.log(`[dry-run] Would execute: ${cmd.command} ${cmd.args.join(' ')}`);
    console.log(`Target channel / version: ${target}`);
    return;
  }

  console.error(formatSelfUpdateStart(version, target, options.npmBin));
  const started = Date.now();
  const result = runner(cmd.command, cmd.args, selfUpdateSpawnOptions());
  const elapsed = Date.now() - started;

  if (result.error) {
    console.error(`\nError: ${result.error.message}`);
    console.error(selfUpdateFailureHint(target, options.npmBin));
    throw new Error(`Self-update failed: ${result.error.message}`);
  }

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    console.error(`\n${formatSelfUpdateResult(false, elapsed)}`);
    console.error(selfUpdateFailureHint(target, options.npmBin));
    throw new Error(`Self-update failed with exit code ${exitCode}`);
  }

  console.error(`\n${formatSelfUpdateResult(true, elapsed)}`);
}
