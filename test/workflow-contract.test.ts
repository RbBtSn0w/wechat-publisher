import fs from 'fs';
import { expect, test } from 'vitest';
const read = (file: string) => fs.readFileSync(file, 'utf8');

test('package entrypoint and payload are explicit and release plugins are declared', () => {
  const pkg = JSON.parse(read('package.json'));
  expect(pkg.main).toBe('dist/src/index.js');
  expect(pkg.files).toEqual(['dist', 'templates', 'skills', 'docs', 'README.md']);
  expect(pkg.devDependencies['semantic-release']).toMatch(/^\^25\./);
  const config = JSON.parse(read('.releaserc.json'));
  const plugins = config.plugins.map((plugin: string | unknown[]) => Array.isArray(plugin) ? plugin[0] : plugin);
  expect(plugins).not.toContain('@semantic-release/git');
  for (const plugin of plugins.filter((name: string) => !name.startsWith('./'))) expect(pkg.devDependencies[plugin]).toBeTruthy();
});
