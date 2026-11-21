import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatTile } from './StatTile';

// Vitest compiles the component's JSX to classic React.createElement calls (tsconfig jsx: preserve),
// so React must be a global for the render.
Object.assign(globalThis, { React });

// Markup is `<tile><label div/><value div/></tile>`; the value div follows the label's close tag.
function valueElement(label: string, value: string | number) {
  const markup = renderToStaticMarkup(createElement(StatTile, { label, value }));
  const match = markup.match(/<\/div><div class="([^"]*)">(.*?)<\/div><\/div>$/);
  if (!match) throw new Error(`value element not found in ${markup}`);
  return { className: match[1], inner: match[2] };
}

describe('StatTile value wrap guard', () => {
  it('breaks a string value after each comma and keeps its text', () => {
    const value = '$6,726,553,623.93';
    const { inner } = valueElement('Market cap', value);
    expect(inner).toBe('$6,<wbr/>726,<wbr/>553,<wbr/>623.93');
    expect(inner.replace(/<[^>]*>/g, '')).toBe(value);
  });

  it('renders a number value without break hints', () => {
    const { inner } = valueElement('Open', 1234567);
    expect(inner).toBe('1234567');
    expect(inner).not.toContain('<wbr');
  });

  it('lets the value wrap anywhere inside its tile', () => {
    expect(valueElement('Cost basis', '$1,234,567,890.12').className).toContain('wrap-anywhere');
  });
});
