import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { PortfolioService } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

const transport = makeBrowserTransport('/trader/api');
export const portfolioClient = createClient(PortfolioService, transport);
