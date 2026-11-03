import fs from 'node:fs';
import { releaseOutput } from './release-helpers.mjs';
import semanticRelease from 'semantic-release';

const released = await semanticRelease();
const result = releaseOutput(released);
if (result.released) {
  if (!/^[a-f0-9]{40}$/.test(released.nextRelease.gitHead || '')) throw new Error('Invalid release commit identity.');
  result.git_head = released.nextRelease.gitHead;
}
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
}
console.log(JSON.stringify(result));
