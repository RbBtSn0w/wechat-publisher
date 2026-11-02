import semver from 'semver';

export function previewBase(manifestVersion, tags) {
  const versions = [manifestVersion, ...tags.filter(tag => /^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(tag)).map(tag => tag.slice(1))]
    .filter(version => semver.valid(version));
  if (!versions.length) throw new Error('No trusted semantic version is available.');
  return versions.map(version => `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}`)
    .sort(semver.rcompare)[0];
}

export function releaseOutput(result) {
  if (!result) return { released: false, version: '', channel: '' };
  const version = result.nextRelease?.version;
  const channel = result.nextRelease?.channel ?? 'latest';
  if (!semver.valid(version) || !['latest', 'beta'].includes(channel)) throw new Error('Invalid semantic-release result.');
  return { released: true, version, channel };
}

export function issueReferences(body, linked = []) {
  const refs = new Set(linked.filter(issue => Number.isSafeInteger(issue.number) && issue.number > 0).map(issue => issue.number));
  for (const match of (body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*((?:#\d+)(?:[\s,]+#\d+)*)/gi)) {
    for (const number of match[1].matchAll(/#(\d+)/g)) refs.add(Number(number[1]));
  }
  return [...refs].sort((a, b) => a - b);
}
