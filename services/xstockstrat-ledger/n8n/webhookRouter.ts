/**
 * n8n/webhookRouter.ts
 * Translates incoming n8n HTTP POST payloads to internal LedgerService gRPC calls.
 * Mount at: POST /webhooks/n8n/:action
 *
 * xstockstrat Spine pattern: n8n Cloud → HTTP → this handler → gRPC → LedgerService
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import express, { Request, Response } from 'express';
import path from 'path';
import { getLogger } from '../services/logger';

const log = getLogger('ledger:n8n');
const router = express.Router();

const PROTO_PATH = path.resolve(__dirname, '../../../packages/proto/ledger/v1/ledger.proto');
const pkgDef = protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true });
const proto = grpc.loadPackageDefinition(pkgDef) as any;

let ledgerStub: any;
export function initN8nRouter(ledgerEndpoint: string) {
  ledgerStub = new proto.xstockstrat.ledger.v1.LedgerService(
    ledgerEndpoint,
    grpc.credentials.createInsecure(),
  );
  return router;
}

/**
 * POST /webhooks/n8n/append-event
 * Payload: { event_type, source_service, stream_key, payload, metadata?, correlation_id? }
 */
router.post('/append-event', async (req: Request, res: Response) => {
  const { event_type, source_service, stream_key, payload, metadata, correlation_id } = req.body;
  if (!event_type || !source_service || !stream_key) {
    return res.status(400).json({ error: 'event_type, source_service, stream_key required' });
  }
  ledgerStub.appendEvent(
    { event_type, source_service, stream_key, payload: payload ?? {}, metadata: metadata ?? {}, correlation_id: correlation_id ?? '' },
    (err: any, result: any) => {
      if (err) {
        log.error('appendEvent failed', { error: err.message });
        return res.status(500).json({ error: err.message });
      }
      res.json({ event_id: result.event_id, sequence: result.sequence });
    },
  );
});

/**
 * POST /webhooks/n8n/query-events
 * Payload: { stream_key?, event_type?, source_service?, start?, end?, page_size? }
 */
router.post('/query-events', async (req: Request, res: Response) => {
  const { stream_key, event_type, source_service, start, end, page_size } = req.body;
  const request: any = {
    stream_key: stream_key ?? '',
    event_type: event_type ?? '',
    source_service: source_service ?? '',
    page: { page_size: page_size ?? 50 },
  };
  if (start) request.time_range = { start: { seconds: Math.floor(new Date(start).getTime() / 1000) } };
  if (end) request.time_range = { ...request.time_range, end: { seconds: Math.floor(new Date(end).getTime() / 1000) } };

  ledgerStub.queryEvents(request, (err: any, result: any) => {
    if (err) {
      log.error('queryEvents failed', { error: err.message });
      return res.status(500).json({ error: err.message });
    }
    res.json(result);
  });
});
