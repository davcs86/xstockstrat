import { redirect } from 'next/navigation';

// The Signal-detail page was superseded by the unified `/trader/positions/[symbol]` page (feature
// 125). This route is now a redirect-only stub that forwards the symbol and the full query string
// (notably `?strategy=` — it seeds SignalReadiness on the destination) to the unified page.
export default async function MarketSymbolRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { symbol } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else if (value != null) qs.set(key, value);
  }
  const query = qs.toString();
  redirect(`/trader/positions/${symbol}${query ? `?${query}` : ''}`);
}
