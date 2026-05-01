import { LedgerServiceService } from '@xstockstrat/proto/ledger/v1/ledger';
import type { ServiceDefinition } from '@grpc/grpc-js';

export function createLedgerServiceDefinition(): ServiceDefinition {
  return LedgerServiceService;
}
