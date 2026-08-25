import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';

const transport = makeBrowserTransport('/trader/api');
export const ledgerClient = createClient(LedgerService, transport);
