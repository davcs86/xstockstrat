import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

const transport = createConnectTransport({ baseUrl: '/trader/api' });
export const portfolioClient = createClient(PortfolioService, transport);
