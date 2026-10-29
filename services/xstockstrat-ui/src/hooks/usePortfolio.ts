import { useQuery } from '@tanstack/react-query';
import { portfolioClient } from '@/lib/browserClients/portfolioClient';
import type { EnvironmentMode } from '@/context/AccountContext';
import { toPbTradingMode } from '@/lib/tradingMode';
import { PositionSide } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { isNotFoundError } from '@/lib/scoreDisplay';

export function usePortfolio(mode: EnvironmentMode | null, selectedAccountId: string | null) {
  return useQuery({
    queryKey: ['portfolio', mode, selectedAccountId],
    queryFn: () =>
      portfolioClient.getPortfolio({
        tradingMode: toPbTradingMode(mode),
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

// Paginated, server-side-filtered open positions (ListPositions). The winners/losers P&L-sign
// filter is applied client-side over the service's enriched unrealizedPnl.
export function usePositions(
  mode: EnvironmentMode | null,
  selectedAccountId: string | null,
  filters: PositionFilters = {},
) {
  const { symbol = '', side = PositionSide.UNSPECIFIED, pageToken = '', pageSize = 25 } = filters;
  return useQuery({
    queryKey: ['positions', mode, selectedAccountId, symbol, side, pageToken, pageSize],
    queryFn: () =>
      portfolioClient.listPositions({
        tradingMode: toPbTradingMode(mode),
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
        ...(symbol ? { symbol } : {}),
        side,
        page: { pageSize, pageToken },
      }),
    refetchInterval: 10_000,
  });
}

// Reads one broker-authoritative Position (GetPosition), not a client-side listPositions filter, so
// unrealized P&L ties to the Exposure list and Portfolio (C-10(b) valuation parity). Disabled until a symbol is set.
export function usePosition(
  symbol: string,
  mode: EnvironmentMode | null,
  selectedAccountId: string | null,
) {
  return useQuery({
    queryKey: ['position', mode, selectedAccountId, symbol],
    enabled: !!symbol,
    queryFn: () =>
      portfolioClient.getPosition({
        tradingMode: toPbTradingMode(mode),
        symbol,
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      }),
    // NotFound (unheld symbol) is expected on the unified symbol page — don't retry it or keep
    // polling a symbol that will never resolve.
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1,
    refetchInterval: (query) => (isNotFoundError(query.state.error) ? false : 10_000),
  });
}
