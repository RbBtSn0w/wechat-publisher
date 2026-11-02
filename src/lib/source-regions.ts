/** Source offsets use UTF-16 indices, matching String.slice and RegExp.exec. */
export interface SourceRegion {
  start: number;
  end: number;
}

export interface FencedCodeRegion extends SourceRegion {
  info: string;
  contentStart: number;
  contentEnd: number;
}

function scanRegions(source: string): { protected: SourceRegion[]; fences: FencedCodeRegion[] } {
  const protectedRegions: SourceRegion[] = [];
  const fences: FencedCodeRegion[] = [];
  let index = 0;
  while (index < source.length) {
    if (index === 0 || source[index - 1] === '\n') {
      const lineEnd = source.indexOf('\n', index);
      const end = lineEnd < 0 ? source.length : lineEnd + 1;
      const opening = source.slice(index, end).match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/);
      if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
        const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*\\r?$`, 'gm');
        closing.lastIndex = end;
        const match = closing.exec(source);
        const regionEnd = match ? match.index + match[0].length + (source[match.index + match[0].length] === '\n' ? 1 : 0) : source.length;
        const region = { start: index, end: regionEnd, info: opening[2].trim(), contentStart: end, contentEnd: match?.index ?? source.length };
        protectedRegions.push(region);
        fences.push(region);
        index = regionEnd;
        continue;
      }
    }
    if (source[index] === '<') {
      const opening = source.slice(index).match(/^<(pre|code)\b[^>]*>/i);
      if (opening) {
        const closing = new RegExp(`</${opening[1]}\\s*>`, 'ig');
        closing.lastIndex = index + opening[0].length;
        const match = closing.exec(source);
        const end = match ? match.index + match[0].length : source.length;
        protectedRegions.push({ start: index, end });
        index = end;
        continue;
      }
    }
    if (source[index] === '`' && (index === 0 || source[index - 1] !== '\\')) {
      const start = index;
      while (source[index] === '`') index += 1;
      const length = index - start;
      const remainder = source.slice(index);
      const boundary = /\r?\n[ \t]*\r?\n|\r?\n {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|>|[-+*][ \t]|\d+[.)][ \t]|<(?:pre|code)\b)/i.exec(remainder);
      const blockEnd = boundary ? index + boundary.index : source.length;
      const runs = /`+/g;
      runs.lastIndex = index;
      let match: RegExpExecArray | null;
      while ((match = runs.exec(source))) {
        if (match.index >= blockEnd) break;
        if (match[0].length === length) {
          const end = match.index + length;
          protectedRegions.push({ start, end });
          index = end;
          break;
        }
      }
      continue;
    }
    index += 1;
  }
  return { protected: protectedRegions, fences };
}

/** Hide code examples without moving source offsets or line boundaries. */
export function maskProtectedRegions(source: string): string {
  const characters = source.split('');
  for (const region of scanRegions(source).protected) {
    for (let index = region.start; index < region.end; index += 1) {
      if (characters[index] !== '\r' && characters[index] !== '\n') characters[index] = ' ';
    }
  }
  return characters.join('');
}

export function findFencedCodeRegions(source: string): FencedCodeRegion[] {
  return scanRegions(source).fences;
}

export function replaceSourceRegions(source: string, edits: (SourceRegion & { replacement: string })[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
