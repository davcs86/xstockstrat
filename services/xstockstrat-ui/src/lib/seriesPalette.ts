export type PaletteEntry = { token: string; fallback: string };

// The single source of the series token list; the colour values live only in src/styles/themes/*.css.
export const SERIES_PALETTE: readonly PaletteEntry[] = [
  { token: '--series-1', fallback: 'yellowgreen' },
  { token: '--series-2', fallback: 'darkviolet' },
  { token: '--series-3', fallback: 'lightpink' },
  { token: '--series-4', fallback: 'saddlebrown' },
  { token: '--series-5', fallback: 'deepskyblue' },
  { token: '--series-6', fallback: 'seagreen' },
  { token: '--series-7', fallback: 'aquamarine' },
  { token: '--series-8', fallback: 'olive' },
  { token: '--series-9', fallback: 'teal' },
  { token: '--series-10', fallback: 'khaki' },
  { token: '--series-11', fallback: 'crimson' },
  { token: '--series-12', fallback: 'cornflowerblue' },
];
