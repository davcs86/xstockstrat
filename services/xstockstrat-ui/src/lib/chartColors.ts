// Chart color-token resolver (feature 146). lightweight-charts renders to a canvas and **throws**
// ("Failed to parse color") on modern CSS Color 4 strings like `oklch(...)` — which is exactly the
// form this app's theme tokens (`--chart-*`, `--muted-foreground`, `--border`) are declared in. And
// current Chromium preserves the color space in both `getComputedStyle(...).color` and canvas
// `fillStyle` serialization, so a naive read-back returns the oklch string unchanged. The only
// reliable conversion is to **paint the color to a 1×1 canvas and read the rendered sRGB bytes** —
// that yields an `rgb()`/`rgba()` string lightweight-charts accepts, for any input color space
// (oklch, hsl, hex, named).
//
// This is also the AC-2 objective backstop: both chart surfaces read their colors from these same
// `--chart-*`/theme tokens (no hardcoded hex). Canvas fills are not DOM-inspectable, so the pure
// branches here are unit-tested (constants + SSR fallback) and the conversion is proven in a real
// browser (the feature's diagnosed chromium run / CI e2e).

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

// Paint `value` to a 1×1 canvas and read back the rendered sRGB pixel → `rgb()`/`rgba()`. Works for
// oklch/hsl/hex/named alike. Returns null off-DOM or when a 2D context is unavailable. An unparseable
// color leaves the default fill (transparent-black) rather than throwing — the caller's fallback then
// applies via the empty-var / null paths, and known theme tokens always parse.
function cssColorToRgb(value: string): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
}

/**
 * Resolve a CSS custom property (e.g. `--chart-1`, `--chart-grid`, `--color-buy`) to a canvas-usable
 * `rgb()`/`rgba()` color string for lightweight-charts. Off-DOM (SSR / node), or on any read/convert
 * failure, returns `fallback` rather than throwing, so importing/calling this never breaks server
 * rendering. Pass a canvas-safe (`rgb`/named) `fallback`.
 */
export function resolveChartColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  return cssColorToRgb(raw) ?? fallback;
}
