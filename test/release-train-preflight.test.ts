import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, expect, test } from 'vitest';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const python = fs.existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-lifecycle-preflight-'));
  roots.push(root);
  const state = path.join(root, 'state');
  fs.mkdirSync(state, { mode: 0o700 });
  const policy = path.join(root, 'policy.json');
  fs.writeFileSync(policy, JSON.stringify({ ...JSON.parse(fs.readFileSync('scripts/release-train-policy.example.json', 'utf8')), state_dir: state }), { mode: 0o600 });
  const controller = path.join(root, 'release_train_lifecycle.py');
  fs.copyFileSync('scripts/release_train_lifecycle.py', controller);
  fs.chmodSync(controller, 0o600);
  const args = ['scripts/release-train-preflight.py', '--config', policy, '--controller', controller, '--provenance', 'scripts/release-train-controller.json'];
  const run = (...extra: string[]) => spawnSync(python, [...args, ...extra], {
    encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', PYTHONDONTWRITEBYTECODE: '1' },
  });
  return { root, state, policy, controller, run };
}

test('staged preflight verifies the actual controller and policy without initializing journal metadata', () => {
  const item = fixture();
  const result = item.run('--check');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ result: 'STAGED', credential_present: false, cycle_count: 0 });
  expect(fs.readdirSync(item.state)).toEqual([]);
});

test('missing state and changed controller fail closed without replacement files', () => {
  const item = fixture();
  fs.rmSync(item.state, { recursive: true });
  expect(item.run('--check').status).toBe(2);
  expect(fs.existsSync(item.state)).toBe(false);
  fs.mkdirSync(item.state, { mode: 0o700 });
  fs.appendFileSync(item.controller, '\n# changed\n');
  const changed = item.run('--check');
  expect(changed.status).toBe(2);
  expect(changed.stderr).toContain('digest');
});

test('unsafe policy permissions and external symlink controllers are refused', () => {
  const item = fixture();
  fs.chmodSync(item.policy, 0o644);
  const unsafe = item.run('--check');
  expect(unsafe.status).toBe(2);
  expect(unsafe.stderr).toContain('private');
  fs.chmodSync(item.policy, 0o600);
  const target = path.join(item.root, 'controller-target.py');
  fs.renameSync(item.controller, target);
  fs.symlinkSync(target, item.controller);
  const linked = item.run('--check');
  expect(linked.status).toBe(2);
  expect(linked.stderr).toContain('symlinks');
});

test('reconcile requires an explicit automation credential and a matching wakeup event', () => {
  const item = fixture();
  const event = path.join(item.root, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ repository: { id: 1174169063 } }));
  const result = item.run('--reconcile', '--event-file', event);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('GH_TOKEN');
  expect(fs.readdirSync(item.state)).toEqual([]);
  fs.writeFileSync(event, JSON.stringify({ repository: { id: 1 } }));
  const wrong = item.run('--check', '--event-file', event);
  expect(wrong.status).toBe(2);
  expect(wrong.stderr).toContain('repository');
});
