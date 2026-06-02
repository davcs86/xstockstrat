import { useQuery } from '@tanstack/react-query';
import { portfolioClient } from '@/lib/browserClients/portfolioClient';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';

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

export function usePositions(mode: 'paper' | 'live', selectedAccountId: string | null) {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['positions', mode, selectedAccountId],
    queryFn: () =>
      portfolioClient.getPortfolio({
        tradingMode: toPbMode(mode),
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      }),
    refetchInterval: 10_000,
  });
}
