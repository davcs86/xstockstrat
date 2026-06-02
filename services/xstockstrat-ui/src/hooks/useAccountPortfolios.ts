import { useQuery } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { portfolioClient } from '@/lib/browserClients/portfolioClient';

type BrokerAccount = Awaited<ReturnType<typeof tradingClient.listBrokerAccounts>>['accounts'][number];
type Portfolio = Awaited<ReturnType<typeof portfolioClient.listPortfolios>>['portfolios'][number];

export function useAccountPortfolios(accountId: string) {
  return useQuery<{ accounts: BrokerAccount[]; portfolios: Portfolio[] }>({
    queryKey: ['acct-portfolios', accountId],
    queryFn: async () => {
      const [a, p] = await Promise.all([
        tradingClient.listBrokerAccounts({}),
        portfolioClient.listPortfolios(accountId ? { accountId } : {}),
      ]);
      return { accounts: a.accounts, portfolios: p.portfolios };
    },
    refetchInterval: 30_000,
  });
}
