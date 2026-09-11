import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';

// Insights-segment LedgerService client, bound to /insights/api (distinct from the /trader/api
// ledgerClient) — queryEvents reaches the insights BFF, which forces the caller's own stream key (IDOR).
const transport = makeBrowserTransport('/insights/api');
export const insightsLedgerClient = createClient(LedgerService, transport);
