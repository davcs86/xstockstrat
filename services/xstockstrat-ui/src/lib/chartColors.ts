// Chart color-token resolver. lightweight-charts renders to canvas and THROWS on CSS Color 4 colors
// like `oklch(...)` (the form this app's theme tokens use), and getComputedStyle preserves the color
// space — so the only reliable conversion is to paint to a 1×1 canvas and read back the sRGB bytes.

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

// Paint `value` to a 1×1 canvas and read back the sRGB pixel → `rgb()`/`rgba()` (works for
// oklch/hsl/hex/named). Returns null off-DOM/without a 2D context; an unparseable color won't throw.
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
