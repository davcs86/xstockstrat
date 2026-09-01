import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';

// Insights-segment LedgerService client (feature 031 performance dashboard). Bound to
// /insights/api — distinct from the /trader/api ledgerClient — so queryEvents reaches the insights
// BFF, which forces the caller's own portfolio:<user_id> stream key server-side (IDOR guard).
const transport = makeBrowserTransport('/insights/api');
export const insightsLedgerClient = createClient(LedgerService, transport);
