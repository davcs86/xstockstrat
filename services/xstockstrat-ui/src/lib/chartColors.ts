// Chart color-token resolver (feature 146). lightweight-charts renders to a canvas, and a canvas
// fillStyle rejects modern `oklch(...)` color strings in engines below Chrome 111. This resolves a
// CSS custom property to a canvas-usable color: canvas-safe forms (hsl/rgb/hex) pass through; an
// oklch/oklab token is resolved to `rgb(...)` via a hidden probe element the browser computes for us.
// The app is dark-only with static `:root` values (no light-mode toggle), so a token resolves once.
//
// This is also the AC-2 objective backstop: because both chart surfaces read their colors from these
// same `--chart-*`/theme tokens (no hardcoded hex), and canvas fills are not DOM-inspectable, the pure
// branches here are unit-tested and the live probe is proven in the diagnosed chromium e2e run.

/** The dedicated, actually-visible gridline token — NOT `--border` (which is 10%-alpha white and
 * near-erases gridlines on the card background). Defined in `globals.css` `:root`. */
export const CHART_GRID_TOKEN = '--chart-grid';

/** The custom properties the unified price + indicator chart surfaces consume. */
export const CHART_COLOR_TOKENS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--muted-foreground',
  CHART_GRID_TOKEN,
  '--color-buy',
  '--color-sell',
] as const;

// oklch/oklab/lab/lch/color() are the CSS4 color spaces a pre-111 canvas can reject; everything else
// (hsl, rgb, hex, named) canvas accepts directly.
const NON_CANVAS_SAFE = /^(oklch|oklab|lab|lch|color)\(/i;

/** True when `value` can be handed to a canvas fill/stroke as-is (hsl/rgb/hex); false for oklch etc. */
export function isCanvasSafeColor(value: string): boolean {
  return !NON_CANVAS_SAFE.test(value.trim());
}

// Resolve a raw oklch (etc.) string to `rgb(...)` by letting the browser compute it on a throwaway
// element. Returns null off-DOM. Not reachable in node — covered by the chromium e2e run.
function probeToRgb(rawValue: string): string | null {
  const el = document.createElement('span');
  el.style.color = rawValue;
  el.style.position = 'absolute';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  el.remove();
  return computed || null;
}

/**
 * Resolve a CSS custom property (e.g. `--chart-1`, `--chart-grid`, `--color-buy`) to a canvas-usable
 * color string. Off-DOM (SSR / node), or on any read/probe failure, returns `fallback` rather than
 * throwing, so importing/calling this never breaks server rendering.
 */
export function resolveChartColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  if (isCanvasSafeColor(raw)) return raw;
  return probeToRgb(raw) ?? fallback;
}
