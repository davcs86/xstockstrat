import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';

/** Canonical display label for a broker type. Single source of truth (DRY guard rail). */
export function brokerLabel(brokerType: BrokerType): string {
  return brokerType === BrokerType.IBKR ? 'IBKR' : 'Alpaca';
}
