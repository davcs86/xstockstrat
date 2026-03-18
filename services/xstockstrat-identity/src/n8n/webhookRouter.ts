import * as http from 'http';
import { IdentityServiceImpl } from '../grpc/identityServiceImpl';
import { getLogger } from '../services/logger';

const log = getLogger('identity:n8n');

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
 * n8n webhook router for xstockstrat-identity.
 * Endpoints:
 *   POST /webhooks/n8n/validate-token  — validate a JWT and return claims
 *   POST /webhooks/n8n/create-apikey   — create a new API key for a user
 */
export function createN8nRouter(impl: IdentityServiceImpl) {
  return async function n8nHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    try {
      const body = await readBody(req);
      const url = req.url ?? '';

      if (url === '/webhooks/n8n/validate-token') {
        const result = await callImpl(impl.validateToken.bind(impl), { token: body.token });
        log.info('n8n validate-token');
        send(res, 200, result);
        return;
      }

      if (url === '/webhooks/n8n/create-apikey') {
        const result = await callImpl(impl.createApiKey.bind(impl), {
          user_id: body.user_id,
          name: body.name,
          scopes: body.scopes ?? [],
        });
        log.info('n8n create-apikey', { user_id: body.user_id });
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
