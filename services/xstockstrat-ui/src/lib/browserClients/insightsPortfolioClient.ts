import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

// Insights-segment PortfolioService client (feature 058 watchlists). Bound to
// /insights/api — distinct from the /trader/api portfolioClient — so watchlist
// calls reach the insights BFF, which forwards x-user-id for ownership scoping.
const transport = createConnectTransport({ baseUrl: '/insights/api' });
export const insightsPortfolioClient = createClient(PortfolioService, transport);
