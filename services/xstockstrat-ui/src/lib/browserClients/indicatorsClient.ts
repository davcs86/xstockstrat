import { createClient } from '@connectrpc/connect';
import { makeBrowserTransport } from '@/lib/browserClients/transport';
import { IndicatorsService } from '@xstockstrat/proto/indicators/v1/indicators_pb';

const transport = makeBrowserTransport('/insights/api');
export const indicatorsClient = createClient(IndicatorsService, transport);
