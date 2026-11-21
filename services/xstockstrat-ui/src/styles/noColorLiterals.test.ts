import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
// acceptance.feature AC-12, verbatim.
const COLOR_LITERAL = /hsl\(\s*\d|oklch\(|#[0-9a-fA-F]{6}\b/;
const isComment = (line: string) => /^(\/\/|\/\*|\*)/.test(line.trim());

const sourceFiles = readdirSync(SRC, { recursive: true })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
  .filter((f) => !f.split(path.sep).join('/').startsWith('components/ui/'));

describe('no hardcoded colours outside the theme tokens (AC-12)', () => {
  it('finds no colour literal on a non-comment line of src/**/*.ts(x)', () => {
    const hits: string[] = [];
    for (const rel of sourceFiles) {
      readFileSync(path.join(SRC, rel), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!isComment(line) && COLOR_LITERAL.test(line)) hits.push(`src/${rel}:${i + 1}`);
        });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('keeps the sidebar shadow on the oklch token, not an hsl() wrapper', () => {
    const sidebar = readFileSync(path.join(SRC, 'components', 'ui', 'sidebar.tsx'), 'utf8');
    expect(sidebar).not.toContain('hsl(var(--sidebar-border))');
  });
});
