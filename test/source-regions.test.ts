import { expect, test } from 'vitest';
import { maskProtectedRegions, replaceSourceRegions } from '../src/lib/source-regions';
import { findResourceOccurrences, extractMermaidBlocks } from '../src/lib/parser';

test('protected masks retain UTF-16 offsets, CRLF boundaries and surrounding prose', () => {
  const source = '😀 Before <code>local://example.png\r\n[TODO]</code> after local://real.png';
  const visible = maskProtectedRegions(source);
  expect(visible.length).toBe(source.length);
  expect(visible.indexOf('\r\n')).toBe(source.indexOf('\r\n'));
  expect(visible).toContain('after local://real.png');
  const occurrences = findResourceOccurrences(source);
  expect(occurrences.map(item => item.path)).toEqual(['local://real.png']);
  expect(source.slice(occurrences[0].start, occurrences[0].end)).toBe('local://real.png');
  expect(replaceSourceRegions(source, occurrences.map(item => ({ ...item, replacement: 'cdn.png' })))).toBe(source.replace('local://real.png', 'cdn.png'));
});

test('nested Mermaid examples remain protected while longer closing fences work', () => {
  const source = ['````markdown', '```mermaid', 'A-->B', '```', '````', '~~~mermaid', 'C-->D', '~~~~'].join('\n');
  expect(extractMermaidBlocks(source)).toEqual(['C-->D']);
});

test('HTML comments cannot open protected code regions over following prose', () => {
  const source = '<!-- <code> local://example.png -->\n<img src="local://real.png">';
  expect(findResourceOccurrences(source, { markdownInline: false }).map(item => item.path)).toEqual(['local://real.png']);
  expect(maskProtectedRegions(source)).toContain('<img src="local://real.png">');
  expect(findResourceOccurrences('<!-- <pre> local://example.png', { markdownInline: false })).toEqual([]);
});
