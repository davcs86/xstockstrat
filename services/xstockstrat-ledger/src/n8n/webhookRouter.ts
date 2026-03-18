import * as http from 'http';
import { LedgerServiceImpl } from '../grpc/ledgerServiceImpl';
import { getLogger } from '../services/logger';

const log = getLogger('ledger:n8n');

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch (err) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function callImpl<T>(fn: (req: { request: any }, cb: (err: any, res: T) => void) => void, request: any): Promise<T> {
  return new Promise((resolve, reject) => {
    fn({ request }, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

function send(res: http.ServerResponse, status: number, body: any) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

/**
 * n8n webhook router for xstockstrat-ledger.
 * Endpoints:
 *   POST /webhooks/n8n/append-event  — append an event to the ledger
 *   POST /webhooks/n8n/query-events  — query events by stream_key / filters
 */
export function createN8nRouter(impl: LedgerServiceImpl) {
  return async function n8nHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const body = await readBody(req);
      const url = req.url ?? '';

      if (url === '/webhooks/n8n/append-event') {
        const result: any = await callImpl(impl.appendEvent.bind(impl), {
          event_type: body.event_type,
          source_service: body.source_service ?? 'n8n',
          stream_key: body.stream_key,
          payload: typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload ?? {}),
          metadata: typeof body.metadata === 'string' ? body.metadata : JSON.stringify(body.metadata ?? {}),
          correlation_id: body.correlation_id ?? '',
        });
        log.info('n8n append-event', { stream_key: body.stream_key, event_type: body.event_type });
        send(res, 200, { success: true, ...(result ?? {}) });
        return;
      }

      if (url === '/webhooks/n8n/query-events') {
        const result = await callImpl(impl.queryEvents.bind(impl), {
          stream_key: body.stream_key,
          event_type: body.event_type,
          source_service: body.source_service,
          time_range: body.start || body.end ? {
            start: body.start ? { seconds: Math.floor(new Date(body.start).getTime() / 1000) } : undefined,
            end: body.end ? { seconds: Math.floor(new Date(body.end).getTime() / 1000) } : undefined,
          } : undefined,
          page: { page_size: body.page_size ?? 50, page_token: body.page_token ?? '' },
        });
        send(res, 200, result);
        return;
      }

      send(res, 404, { error: 'unknown n8n webhook endpoint' });
    } catch (err: any) {
      log.error('n8n webhook error', { error: err.message });
      send(res, 500, { error: err.message });
    }
  };
}
