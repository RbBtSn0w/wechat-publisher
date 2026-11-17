import { verifyMarkdownDependency } from './markdown-dependency.mjs';

const sdk = verifyMarkdownDependency(process.cwd());
console.log(`Verified Markdown dependency: ${sdk.name}@${sdk.version}`);
