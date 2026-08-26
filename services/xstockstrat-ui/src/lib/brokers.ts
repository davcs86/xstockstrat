import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';

/** Canonical display label for a broker type. Single source of truth (DRY guard rail). */
export function brokerLabel(brokerType: BrokerType): string {
  switch (brokerType) {
    case BrokerType.IBKR:
      return 'IBKR';
    case BrokerType.OFFLINE:
      return 'Offline';
    default:
      return 'Alpaca';
  }
}
