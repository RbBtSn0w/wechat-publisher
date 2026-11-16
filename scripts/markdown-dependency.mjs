import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import semver from 'semver';

const sdkName = '@rbbtsn0w/wechat-markdown';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function installedMarkdown(root) {
  const consumerRequire = createRequire(path.resolve(root, 'package.json'));
  let directory = path.dirname(consumerRequire.resolve(sdkName));
  // Resolve from this consumer; the SDK does not export package.json.
  while (true) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const metadata = readJson(manifest);
      if (metadata.name === sdkName) return metadata;
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, 'Cannot locate installed SDK metadata');
    directory = parent;
  }
}

export function verifyMarkdownDependency(root, { requireLockfile = true } = {}) {
  const pkg = readJson(path.join(root, 'package.json'));
  const version = pkg.dependencies?.[sdkName];
  assert(typeof version === 'string' && semver.valid(version) === version && !semver.prerelease(version),
    'Markdown dependency must be an exact stable version');
  if (requireLockfile) {
    const lock = readJson(path.join(root, 'package-lock.json'));
    assert.equal(lock.packages?.['']?.dependencies?.[sdkName], version, 'Markdown lockfile requirement differs from manifest');
    const locked = lock.packages?.[`node_modules/${sdkName}`];
    assert(locked?.version === version && !locked.link, 'The locked SDK must match the exact manifest version');
  }
  const installed = installedMarkdown(root);
  assert.equal(installed.version, version, 'The installed SDK differs from the exact manifest version');
  const consumerNode = pkg.engines?.node;
  const sdkNode = installed.engines?.node;
  assert(typeof consumerNode === 'string' && typeof sdkNode === 'string'
    && semver.validRange(consumerNode) && semver.validRange(sdkNode)
    && semver.subset(consumerNode, sdkNode), 'Publisher Node range must be supported by the SDK');
  assert(semver.satisfies(process.versions.node, consumerNode), 'Current Node runtime does not satisfy the publisher engine');
  return installed;
}
