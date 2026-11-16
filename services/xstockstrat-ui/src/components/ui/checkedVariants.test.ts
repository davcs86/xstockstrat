import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { beforeAll, describe, expect, it } from 'vitest';

// Test files are excluded from the Tailwind scan, so a rule exists only if a component carries it.
const GLOBALS_CSS = fileURLToPath(new URL('../../app/globals.css', import.meta.url));

let selectors: string[] = [];

beforeAll(async () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const result = await postcss([tailwind()]).process(css, { from: GLOBALS_CSS });
  const collected: string[] = [];
  result.root.walkRules((rule) => {
    collected.push(rule.selector.replaceAll("'", '"'));
  });
  selectors = collected;
});

describe('compiled shadcn state variants match the Radix attributes', () => {
  it.each([
    ['switch root', String.raw`.data-checked\:bg-primary`, '[data-state="checked"]'],
    [
      'switch thumb, on',
      String.raw`.data-checked\:translate-x-\[calc\(100\%-4px\)\]`,
      '[data-state="checked"]',
    ],
    ['switch thumb, off', String.raw`.data-unchecked\:translate-x-0`, '[data-state="unchecked"]'],
    ['checkbox', String.raw`.data-checked\:text-primary-foreground`, '[data-state="checked"]'],
    ['field label', String.raw`.has-data-checked\:bg-input\/30`, '[data-state="checked"]'],
    [
      'questionnaire choice',
      String.raw`.group-data-checked\/questionnaire-choice\:bg-primary`,
      '[data-checked]',
    ],
    ['overlay open', String.raw`.data-open\:animate-in`, '[data-state="open"]'],
    ['overlay closed', String.raw`.data-closed\:animate-out`, '[data-state="closed"]'],
    ['active tab', String.raw`.data-active\:bg-background`, '[data-state="active"]'],
    ['horizontal separator', String.raw`.data-horizontal\:h-px`, '[data-orientation="horizontal"]'],
    ['vertical separator', String.raw`.data-vertical\:w-px`, '[data-orientation="vertical"]'],
    [
      'disabled item',
      String.raw`.data-disabled\:opacity-50`,
      '[data-disabled]:not([data-disabled="false"])',
    ],
  ])('%s: %s matches %s', (_case, prefix, attribute) => {
    const matching = selectors.filter((s) => s.startsWith(prefix));
    expect(matching.length).toBeGreaterThan(0);
    for (const selector of matching) expect(selector).toContain(attribute);
  });

  it('emits the no-scrollbar utility', () => {
    expect(selectors).toContain('.no-scrollbar');
  });
});
