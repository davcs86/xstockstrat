import * as http from 'http';
import { NotifyServiceImpl } from '../grpc/notifyServiceImpl';
import { getLogger } from '../services/logger';

const log = getLogger('notify:n8n');

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
 * n8n webhook router for xstockstrat-notify.
 * Endpoints:
 *   POST /webhooks/n8n/emit-alert   — emit an alert
 *   POST /webhooks/n8n/list-alerts  — list recent alerts
 */
export function createN8nRouter(impl: NotifyServiceImpl) {
  return async function n8nHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const body = await readBody(req);
      const url = req.url ?? '';

      if (url === '/webhooks/n8n/emit-alert') {
        const result: any = await callImpl(impl.emitAlert.bind(impl), {
          severity: body.severity,
          category: body.category,
          title: body.title ?? '',
          body: body.body ?? body.message ?? '',
          source_service: body.source_service ?? 'n8n',
          target_user_id: body.target_user_id ?? '',
          tags: body.tags ?? [],
          context: body.context ?? {},
          correlation_id: body.correlation_id ?? '',
        });
        log.info('n8n emit-alert', { category: body.category, severity: body.severity });
        send(res, 200, { success: true, ...(result ?? {}) });
        return;
      }

      if (url === '/webhooks/n8n/list-alerts') {
        const result = await callImpl(impl.listAlerts.bind(impl), {
          user_id: body.user_id ?? '',
          categories: body.categories ?? [],
          limit: body.limit ?? 50,
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
