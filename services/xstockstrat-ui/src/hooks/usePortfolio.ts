import { useQuery } from '@tanstack/react-query';
import { portfolioClient } from '@/lib/browserClients/portfolioClient';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { PositionSide } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

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
