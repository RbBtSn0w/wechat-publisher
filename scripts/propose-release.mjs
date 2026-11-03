import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { repositoryIssueReferences } from './release-helpers.mjs';

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const gh = (...args) => run('gh', args);
const git = (...args) => run('git', args);
const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !process.env.GH_TOKEN) throw new Error('Repository and explicit proposal token are required.');
git('fetch', '--quiet', 'origin', 'main', 'develop');
const ahead = Number(git('rev-list', '--count', 'origin/main..origin/develop'));
if (!ahead) {
  console.log('No commits await promotion.');
} else {
  const fields = git('log', '--format=%H%x00%B%x00', 'origin/main..origin/develop').split('\0');
  const commits = [];
  for (let index = 0; index + 1 < fields.length; index += 2) commits.push({ hash: fields[index].trim(), message: fields[index + 1].trim() });
  const type = await analyzeCommits({}, { commits, logger: console });
  if (!type) {
    console.log('No release-worthy commits await promotion.');
  } else {
    const issues = new Set();
    const seen = new Set();
    for (const commit of commits) {
      const pulls = JSON.parse(gh('api', `repos/${repository}/commits/${commit.hash}/pulls`, '--paginate'));
      for (const pull of pulls.filter(pr => pr.merged_at && pr.base.ref === 'develop')) {
        if (seen.has(pull.number)) continue;
        seen.add(pull.number);
        const details = JSON.parse(gh('pr', 'view', String(pull.number), '--repo', repository, '--json', 'body,closingIssuesReferences'));
        for (const issue of repositoryIssueReferences(details.body, details.closingIssuesReferences, repository)) issues.add(issue);
      }
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-release-proposal-'));
    try {
      const bodyFile = path.join(temporary, 'body.md');
      const refs = [...issues].sort((a, b) => a - b).map(number => `Closes #${number}`);
      fs.writeFileSync(bodyFile, ['### Scheduled Stable Release', '', 'Promotion from `develop` to `main` for human review and merge.', '', `- ${ahead} commit(s) ahead; semantic release type: ${type}.`, '- CI and maintainer approval are required before merging.', '', ...refs, ''].join('\n'));
      const existing = JSON.parse(gh('pr', 'list', '--repo', repository, '--base', 'main', '--head', 'develop', '--state', 'open', '--json', 'number'));
      if (existing.length > 1) throw new Error('Multiple promotion PRs exist; reconcile them manually.');
      if (existing.length) gh('pr', 'edit', String(existing[0].number), '--repo', repository, '--body-file', bodyFile);
      else console.log(gh('pr', 'create', '--repo', repository, '--base', 'main', '--head', 'develop', '--title', 'chore(release): promote develop to stable', '--body-file', bodyFile));
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
}
