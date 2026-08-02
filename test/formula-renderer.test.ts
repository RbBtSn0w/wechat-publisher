import fs from 'fs';
import { expect, test } from 'vitest';
import { FormulaRenderer } from '../src/lib/formula-renderer';

test('FormulaRenderer renders deterministic PNG output', async () => {
  const renderer = new FormulaRenderer();
  const first = await renderer.renderToImage('E=mc^2', false);
  const second = await renderer.renderToImage('E=mc^2', false);

  expect(second).toBe(first);
  expect(fs.readFileSync(first).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
});
