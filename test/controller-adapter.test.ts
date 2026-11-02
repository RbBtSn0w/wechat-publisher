import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'yaml';
import { expect, test } from 'vitest';

test('vendored controller matches its reviewed shared revision and repository policy', () => {
  const provenance = JSON.parse(fs.readFileSync('scripts/release-train-controller.json', 'utf8'));
  expect(provenance.source_commit).toMatch(/^[a-f0-9]{40}$/);
  expect(crypto.createHash('sha256').update(fs.readFileSync('scripts/release_train_lifecycle.py')).digest('hex'))
    .toBe(provenance.sha256);
  const policy = JSON.parse(fs.readFileSync('scripts/release-train-policy.example.json', 'utf8'));
  expect(policy).toMatchObject({ repository: 'RbBtSn0w/wechat-publisher', repository_id: 1174169063,
    mode: 'retained', sync_strategy: 'reviewed-pr', merge_method: 'merge' });
  expect(path.isAbsolute(policy.state_dir)).toBe(true);
  expect(path.relative(process.cwd(), policy.state_dir).startsWith('..')).toBe(true);
  const ci = yaml.parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
  const target = yaml.parse(fs.readFileSync('.github/workflows/pr-target.yml', 'utf8'));
  expect(policy.required_checks).toEqual([ci.jobs.ci.name, target.jobs['validate-base'].name]);
});
