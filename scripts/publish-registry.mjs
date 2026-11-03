import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Read exact identity before treating an existing publication as idempotent success. */
export function publishArtifact(pkg, version, channel, gitHead, registry, options = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-publication-'));
  try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
    const artifact = path.resolve(temporary, packed.filename);
    if (path.dirname(artifact) !== temporary) throw new Error('Invalid npm artifact path.');
    const integrity = `sha512-${createHash('sha512').update(fs.readFileSync(artifact)).digest('base64')}`;
    publishPreparedArtifact(pkg, version, channel, gitHead, registry, options, integrity);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function publishPreparedArtifact(pkg, version, channel, gitHead, registry, options, integrity) {
  const identity = `${pkg.name}@${version}`;
  const registryArgs = ['--registry', registry, ...(options.userconfig ? ['--userconfig', options.userconfig] : [])];
  const exists = () => {
    let output;
    try {
      output = execFileSync('npm', ['view', identity, 'name', 'version', 'gitHead', 'dist.integrity', '--json', ...registryArgs], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      let code;
      try { code = JSON.parse(String(error.stdout)).error?.code; } catch { /* Invalid output is not evidence of absence. */ }
      if (code === 'E404') return false;
      if (error.stderr) process.stderr.write(error.stderr);
      throw new Error(`Cannot verify registry state for ${identity}`, { cause: error });
    }
    const found = JSON.parse(output);
    if (found.name !== pkg.name || found.version !== version || found.gitHead !== gitHead || found['dist.integrity'] !== integrity) {
      throw new Error(`Existing registry artifact identity does not match ${identity} at ${gitHead}`);
    }
    return true;
  };
  if (exists()) {
    console.log(`${identity} already exists in ${registry}; retaining current dist-tags.`);
    return;
  }
  try {
    execFileSync('npm', ['publish', ...registryArgs, '--tag', channel, '--access', 'public', ...(options.provenance ? ['--provenance'] : [])], { stdio: 'inherit' });
  } catch (error) {
    // A race or lost response is reconciled with a read, never another publish.
    if (exists()) {
      console.log(`${identity} already exists in ${registry}; confirmed after publish failure.`);
      return;
    }
    throw error;
  }
}
