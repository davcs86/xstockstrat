import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

// Insights-segment PortfolioService client, bound to /insights/api (distinct from the /trader/api
// portfolioClient) — watchlist calls reach the insights BFF, which forwards x-user-id for ownership.
const transport = makeBrowserTransport('/insights/api');
export const insightsPortfolioClient = createClient(PortfolioService, transport);
