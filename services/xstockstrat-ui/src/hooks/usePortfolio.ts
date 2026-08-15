import { useQuery } from '@tanstack/react-query';
import { portfolioClient } from '@/lib/browserClients/portfolioClient';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { PositionSide } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { isNotFoundError } from '@/lib/scoreDisplay';

export function usePortfolio(mode: 'paper' | 'live', selectedAccountId: string | null) {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['portfolio', mode, selectedAccountId],
    queryFn: () =>
      portfolioClient.getPortfolio({
        tradingMode: toPbMode(mode),
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      }),
    refetchInterval: 10_000,
  });
}

export function usePortfolios(selectedAccountId: string | null) {
  return useQuery({
    queryKey: ['portfolios', selectedAccountId],
    queryFn: () =>
      portfolioClient.listPortfolios(selectedAccountId ? { accountId: selectedAccountId } : {}),
    refetchInterval: 10_000,
  });
}

export interface PositionFilters {
  symbol?: string;
  side?: PositionSide;
  pageToken?: string;
  pageSize?: number;
}

// Paginated, server-side-filtered open positions backed by PortfolioService.ListPositions
// (replaces the prior getPortfolio().positions read). The winners/losers P&L-sign filter is
// applied client-side over the enriched unrealizedPnl returned by the service.
export function usePositions(
  mode: 'paper' | 'live',
  selectedAccountId: string | null,
  filters: PositionFilters = {},
) {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  const { symbol = '', side = PositionSide.UNSPECIFIED, pageToken = '', pageSize = 25 } = filters;
  return useQuery({
    queryKey: ['positions', mode, selectedAccountId, symbol, side, pageToken, pageSize],
    queryFn: () =>
      portfolioClient.listPositions({
        tradingMode: toPbMode(mode),
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
        ...(symbol ? { symbol } : {}),
        side,
        page: { pageSize, pageToken },
      }),
    refetchInterval: 10_000,
  });
}

// Single authoritative position for the dedicated Position page (feature 096) — backed by
// PortfolioService.GetPosition through the trader BFF. Reads one broker-authoritative Position
// (rather than filtering listPositions client-side) so the page's unrealized P&L ties to the
// Exposure list and Portfolio (C-10(b) valuation parity). Disabled until a symbol is set.
export function usePosition(
  symbol: string,
  mode: 'paper' | 'live',
  selectedAccountId: string | null,
) {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['position', mode, selectedAccountId, symbol],
    enabled: !!symbol,
    queryFn: () =>
      portfolioClient.getPosition({
        tradingMode: toPbMode(mode),
        symbol,
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      }),
    // A NotFound (unheld symbol) is a normal, expected state on the unified symbol page — don't
    // burn a retry on it, and don't keep polling GetPosition forever against a symbol that will
    // never resolve (feature 125). Mirrors useStrategies.ts's NotFound-aware retry/refetch guards.
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1,
    refetchInterval: (query) => (isNotFoundError(query.state.error) ? false : 10_000),
  });
}
