import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const archive = 'pr-preview.tgz';
export const npmRegistry = 'https://registry.npmjs.org';
export const mirrorRegistry = 'https://npm.pkg.github.com';
const corePattern = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)';
const stablePattern = new RegExp('^' + corePattern + '$');
const pkg = '@rbbtsn0w/wechat-publisher';
const publishConfig = { access: 'public', registry: npmRegistry + '/' };

function core(version) {
  assert(typeof version === 'string' && version === version.trim() && stablePattern.test(version), 'Invalid stable npm version');
  return version.split('.').map(BigInt);
}

function compare(left, right) {
  for (const [i, segment] of left.entries()) {
    if (segment !== right[i]) return segment > right[i] ? 1 : -1;
  }
  return 0;
}

function suffix(pr, head) {
  assert(/^[1-9][0-9]*$/.test(pr) && /^[0-9a-f]{40}$/.test(head), 'Invalid PR identity');
  const prefix = head.slice(0, 7);
  return '-dev.pr' + pr + '.' + (/^0[0-9]{6}$/.test(prefix) ? 'g' + prefix : prefix);
}

export function versionFor(manifest, pr, head, latest) {
  let version = core(manifest.split(/[-+]/, 1)[0]);
  if (latest !== null) {
    const minimum = core(latest);
    minimum[2] += 1n;
    if (compare(version, minimum) < 0) version = minimum;
  }
  return version.join('.') + suffix(pr, head);
}

export async function readLatest(request = fetch) {
  const url = npmRegistry + '/' + encodeURIComponent(pkg) + '/latest';
  const response = await request(url, {
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert(response.ok, 'npm latest lookup failed (' + response.status + ')');
  const { name, version } = await response.json();
  assert.equal(name, pkg, 'npm latest package does not match');
  core(version);
  return version;
}

export function guard(version, baseline, latest) {
  const preview = core(version.split('-', 1)[0]);
  assert(baseline !== null, 'No verified build-time npm latest. Rerun PR CI.');
  assert(compare(preview, core(baseline)) > 0, 'Preview does not exceed its build baseline');
  assert(compare(preview, core(latest)) > 0, 'Stable npm latest caught up. Rerun PR CI.');
}

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

export function verify(dir, expected, publication = false) {
  const receipt = JSON.parse(readFileSync(join(dir, 'receipt.json'), 'utf8'));
  for (const key of ['pr', 'head', 'runId', 'attempt']) {
    assert.equal(receipt[key], expected[key], 'Preview ' + key + ' does not match');
  }
  assert.equal(receipt.name, pkg, 'Preview receipt package does not match');
  const versionSuffix = suffix(receipt.pr, receipt.head);
  assert(receipt.version.endsWith(versionSuffix), 'Invalid preview version suffix');
  core(receipt.version.slice(0, -versionSuffix.length));
  const path = join(dir, archive);
  const bytes = readFileSync(path);
  assert.equal(receipt.sha256, digest(bytes, 'sha256', 'hex'), 'Archive SHA-256 does not match');
  assert.equal(readFileSync(join(dir, 'SHA256SUMS'), 'utf8'),
    receipt.sha256 + '  ' + archive + '\n', 'Checksum file does not match');
  const packed = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], {
    encoding: 'utf8', timeout: 10000,
  }));
  assert.equal(packed.name, pkg, 'Packed package name does not match');
  assert.equal(packed.version, receipt.version, 'Packed package version does not match');
  if (publication) assert.deepEqual(packed.publishConfig, publishConfig, 'Unexpected publishConfig');
  return { ...receipt, integrity: 'sha512-' + digest(bytes, 'sha512', 'base64') };
}

function installedHint(source, { setup = '', check = '' } = {}) {
  return [
    '### Try this exact CLI', '',
    '```bash', setup, check,
    'npm exec --yes --ignore-scripts --package=' + source + ' -- wechat-pub --version',
    '```', '',
    '### Install or switch to this exact CLI', '',
    '```bash', check,
    'npm install -g --ignore-scripts ' + source + ' &&',
    'wechat-pub --version',
    '```', '',
  ];
}

export function card(receipt, artifactId, repo, { npm, mirror } = {}) {
  assert(/^[1-9][0-9]*$/.test(artifactId) && /^[\w.-]+\/[\w.-]+$/.test(repo));
  const root = 'https://github.com/' + repo;
  const artifact = root + '/actions/runs/' + receipt.runId + '/artifacts/' + artifactId;
  const spec = receipt.name + '@' + receipt.version;
  const lines = [];
  if (npm?.available || mirror?.available) {
    const registryStatus = [
      ...(npm?.available ? ['npmjs'] : []), ...(mirror?.available ? ['GitHub Packages'] : []),
    ].join(' and ');
    lines.push(
      '## Registry preview · `' + spec + '`', '',
      'Verified exact version on ' + registryStatus + '. Archive SHA-256 `' + receipt.sha256 + '`.', '',
      '| Registry | Exact version with verified integrity | `next` at read-back |',
      '| --- | --- | --- |',
    );
    if (npm?.available) lines.push('| npmjs | `' + spec + '` | ' + (npm.next ? 'Pointed here' : 'Unconfirmed') + ' |');
    if (mirror?.available) lines.push('| GitHub Packages | `' + spec + '` | ' + (mirror.next ? 'Pointed here' : 'Unconfirmed') + ' |');
    lines.push('');
    if (npm?.available) lines.push(...installedHint(spec));
    if (mirror?.available && !npm?.available) {
      lines.push(
        'Set `GH_PACKAGES_TOKEN` with `read:packages` to fetch the exact package from GitHub Packages.',
        'The temporary config applies to the fetch only. Dependencies install from npmjs.', '',
        ...installedHint('"$preview_dir/$preview_file"', { setup: [
          'preview_dir="$(mktemp -d)" &&',
          'preview_config="$(mktemp)" &&',
          "printf '%s\\n' '//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}' > \"$preview_config\" &&",
          'preview_file="$(npm pack --ignore-scripts --registry=https://npm.pkg.github.com --pack-destination="$preview_dir" --userconfig="$preview_config" ' + spec + ')" &&',
          'rm -f "$preview_config" &&',
        ].join('\n') }),
      );
    }
    if (npm?.next) {
      lines.push('### Follow the moving channel', '',
        'On npmjs, `wechat-pub update --dev` follows the shared `next` tag. Another PR may move the tag.', '');
    } else {
      lines.push('The repository-wide `next` tag can move when another PR preview is published.', '');
    }
  }
  lines.push(
    '<!-- pr-preview-artifact -->',
    '## PR preview archive · `' + spec + '`', '',
    'Commit [`' + receipt.head + '`](' + root + '/commit/' + receipt.head + ')',
    ' · [CI run ' + receipt.runId + '](' + root + '/actions/runs/' + receipt.runId + ')',
    ' · packaging attempt `' + receipt.attempt + '` · artifact `' + artifactId + '`', '',
  );
  lines.push(receipt.baseline === null
    ? 'Stable npm latest could not be verified for this archive. It is available for local verification.'
    : 'Stable npm latest at the time of packaging was `' + receipt.baseline + '`.', '');
  const check = "printf '%s  %s\\n' '" + receipt.sha256 + "' \"$preview_dir/" + archive + "\" | shasum -a 256 -c -";
  lines.push(
    '### Download and verify the archive', '',
    '[Download the ZIP](' + artifact + ') (14-day retention). A signed-in GitHub account with repository access is required.', '',
    '```bash',
    'preview_dir="$(mktemp -d)"',
    'gh api repos/' + repo + '/actions/artifacts/' + artifactId + '/zip > "$preview_dir/preview.zip" &&',
    '  unzip -q "$preview_dir/preview.zip" -d "$preview_dir" &&',
    '  (cd "$preview_dir" && printf \'%s  %s\\n\' \''
      + receipt.sha256 + '\' \'' + archive + '\' | shasum -a 256 -c -)',
    '```', '',
    'SHA-256 `' + receipt.sha256 + '`', '',
    ...installedHint('"$preview_dir/' + archive + '"', { check: check + ' &&' }),
  );
  return lines.join('\n');
}

function actionIdentity() {
  return {
    pr: process.env.PR_NUMBER, head: process.env.PR_HEAD,
    runId: process.env.SOURCE_RUN_ID || process.env.GITHUB_RUN_ID,
    attempt: process.env.PACKAGING_ATTEMPT || process.env.GITHUB_RUN_ATTEMPT,
  };
}

async function main([command, dir]) {
  if (command === 'prepare') {
    const { pr, head } = actionIdentity();
    let baseline = null;
    try {
      baseline = await readLatest();
    } catch (error) {
      console.warn('::warning::' + error.message + '. Building an artifact-only preview.');
    }
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    writeFileSync(join(dir, 'baseline.json'), JSON.stringify(baseline) + '\n');
    writeFileSync(join(dir, 'version.txt'), versionFor(manifest.version, pr, head, baseline) + '\n');
  } else if (command === 'seal') {
    const sha256 = digest(readFileSync(join(dir, archive)), 'sha256', 'hex');
    const receipt = {
      ...actionIdentity(), name: pkg, sha256,
      version: readFileSync(join(dir, 'version.txt'), 'utf8').trim(),
      baseline: JSON.parse(readFileSync(join(dir, 'baseline.json'), 'utf8')),
    };
    writeFileSync(join(dir, 'SHA256SUMS'), sha256 + '  ' + archive + '\n');
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    verify(dir, actionIdentity());
  } else if (command === 'verify') {
    console.log(JSON.stringify(verify(dir, actionIdentity(), process.env.CHECK_PUBLICATION === 'true')));
  } else if (command === 'card') {
    const receipt = verify(dir, actionIdentity());
    console.log(card(receipt, process.env.ARTIFACT_ID, process.env.GITHUB_REPOSITORY));
  } else {
    throw new Error('Expected prepare, seal, verify, or card');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
