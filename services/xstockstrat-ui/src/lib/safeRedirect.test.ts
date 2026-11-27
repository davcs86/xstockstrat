// C-12: redirect targets are scenario one-offs; no domain object.
import { expect, test } from 'vitest';
import { safeRedirect } from './safeRedirect';

test.each(['/trader', '/trader/positions', '/insights/backtests', '/config-ui', '/config-ui/keys'])(
  'keeps the allow-listed basePath target %s',
  (target) => {
    expect(safeRedirect(target)).toBe(target);
  },
);

test.each([null, '', '/', '/accounts', 'https://evil.example.test', '//evil.example.test'])(
  'falls back to /trader for %s',
  (target) => {
    expect(safeRedirect(target)).toBe('/trader');
  },
);

// D-54 pins today's prefix-only check; changing this value changes login redirect behaviour.
test('pins the current value for a dot-segment target', () => {
  expect(safeRedirect('/trader/../..//evil.com')).toBe('/trader/../..//evil.com');
});
