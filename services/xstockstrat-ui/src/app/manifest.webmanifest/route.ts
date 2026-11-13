// Dynamic so the no-cache header applies and each image serves its own build-time theme colour.
export const dynamic = 'force-dynamic';

export function GET() {
  const color = process.env.UI_THEME_BACKGROUND_HEX;
  return Response.json(
    {
      name: 'xstockstrat',
      short_name: 'xstockstrat',
      description: 'Cross Stock Strategies — trading, insights, and configuration',
      display: 'standalone',
      start_url: '/trader',
      scope: '/',
      background_color: color,
      theme_color: color,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
