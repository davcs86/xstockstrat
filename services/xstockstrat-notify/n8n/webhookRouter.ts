/**
 * n8n/webhookRouter.ts — xstockstrat-notify
 * Translates n8n HTTP payloads to NotifyService gRPC calls.
 */
import express, { Request, Response } from 'express';
import { NotifyServiceImpl } from '../grpc/notifyServiceImpl';
import { getLogger } from '../services/logger';

const log = getLogger('notify:n8n');

export function createN8nRouter(notifyImpl: NotifyServiceImpl) {
  const router = express.Router();

  /**
   * POST /webhooks/n8n/emit-alert
   * Payload: { severity, category, title, body, source_service, target_user_id?, tags?, correlation_id? }
   * severity: 1=INFO, 2=WARNING, 3=ERROR, 4=CRITICAL
   */
  router.post('/emit-alert', (req: Request, res: Response) => {
    const { severity, category, title, body, source_service, target_user_id, tags, correlation_id, context } = req.body;
    if (!category || !title || !source_service) {
      return res.status(400).json({ error: 'category, title, source_service required' });
    }
    notifyImpl.emitAlert(
      {
        request: {
          severity: severity ?? 1,
          category,
          title,
          body: body ?? '',
          source_service,
          target_user_id: target_user_id ?? '',
          tags: tags ?? [],
          correlation_id: correlation_id ?? '',
          context: context ?? {},
        },
      },
      (err: any, result: any) => {
        if (err) {
          log.error('emit-alert failed', { error: err.message });
          return res.status(500).json({ error: err.message });
        }
        log.info('Alert emitted via n8n', { alert_id: result.alert_id, category, severity });
        res.json({ alert_id: result.alert_id });
      },
    );
  });

  /**
   * POST /webhooks/n8n/list-alerts
   * Payload: { user_id?, categories?, limit? }
   */
  router.post('/list-alerts', (req: Request, res: Response) => {
    const { user_id, categories, limit } = req.body;
    notifyImpl.listAlerts(
      { request: { user_id: user_id ?? '', categories: categories ?? [], limit: limit ?? 50 } },
      (err: any, result: any) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
      },
    );
  });

  return router;
}
