import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';

const transport = createConnectTransport({ baseUrl: '/trader/api' });
export const ledgerClient = createClient(LedgerService, transport);
