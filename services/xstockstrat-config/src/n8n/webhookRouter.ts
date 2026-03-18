import * as http from 'http';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { getLogger } from '../services/logger';

const log = getLogger('config:n8n');

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
 * n8n webhook router for xstockstrat-config.
 * Endpoints:
 *   POST /webhooks/n8n/set-config   — update a single config key
 *   POST /webhooks/n8n/rollout      — atomically update multiple keys
 *   POST /webhooks/n8n/list-keys    — list keys for a namespace
 */
export function createN8nRouter(impl: ConfigServiceImpl) {
  return async function n8nHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const body = await readBody(req);
      const url = req.url ?? '';

      if (url === '/webhooks/n8n/set-config') {
        const result: any = await callImpl(impl.setConfig.bind(impl), {
          namespace: body.namespace,
          key: body.key,
          value: body.value,
          author: body.author ?? 'n8n',
          reason: body.reason ?? 'n8n webhook',
          environment: body.environment,
          trading_mode: body.trading_mode,
        });
        log.info('n8n set-config', { namespace: body.namespace, key: body.key });
        send(res, 200, { success: true, ...(result ?? {}) });
        return;
      }

      if (url === '/webhooks/n8n/rollout') {
        const changes: any[] = body.changes ?? [];
        const author = body.author ?? 'n8n';
        const reason = body.reason ?? 'n8n rollout';
        for (const change of changes) {
          await callImpl(impl.setConfig.bind(impl), {
            namespace: change.namespace,
            key: change.key,
            value: change.value,
            author,
            reason,
            environment: change.environment ?? body.environment,
            trading_mode: change.trading_mode ?? body.trading_mode,
          });
        }
        log.info('n8n rollout', { count: changes.length });
        send(res, 200, { success: true, applied: changes.length });
        return;
      }

      if (url === '/webhooks/n8n/list-keys') {
        const result = await callImpl(impl.listKeys.bind(impl), {
          namespace: body.namespace,
          environment: body.environment,
          trading_mode: body.trading_mode,
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
