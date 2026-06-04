import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';

const transport = createConnectTransport({ baseUrl: '/insights/api' });
export const indicatorsClient = createClient(IndicatorsService, transport);
