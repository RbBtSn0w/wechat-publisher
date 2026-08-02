import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TEMP_PATHS } from './constants';

export class FormulaRenderer {
  getHash(expression: string, display: boolean): string {
    return crypto.createHash('sha256').update(`${display ? 'display' : 'inline'}:${expression}`).digest('hex');
  }

  getTargetPath(hash: string): string {
    return path.join(TEMP_PATHS.formula, `${hash}.png`);
  }

  async renderToImage(expression: string, display: boolean): Promise<string> {
    const targetPath = this.getTargetPath(this.getHash(expression, display));
    if (fs.existsSync(targetPath)) return targetPath;

    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: ['base', 'ams'] });
    const svgOutput = new SVG({ fontCache: 'none' });
    const document = mathjax.document('', { InputJax: tex, OutputJax: svgOutput });
    const node = document.convert(expression, { display });
    const rendered = adaptor.outerHTML(node);
    const svg = rendered.match(/<svg[\s\S]*<\/svg>/)?.[0];
    if (!svg) throw new Error('MathJax did not produce an SVG image.');

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    fs.writeFileSync(targetPath, png);
    return targetPath;
  }
}
