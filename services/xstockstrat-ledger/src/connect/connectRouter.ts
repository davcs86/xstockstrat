import type { ConnectRouter } from '@connectrpc/connect';
import { LedgerService } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { LedgerServiceImpl } from '../grpc/ledgerServiceImpl';
import { createLedgerServiceConnectImpl } from './ledgerServiceConnect';

export function createConnectRouter(impl: LedgerServiceImpl) {
  return (router: ConnectRouter) => {
    router.service(LedgerService, createLedgerServiceConnectImpl(impl));
  };
}
