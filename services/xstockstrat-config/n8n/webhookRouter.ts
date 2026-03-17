/**
 * n8n/webhookRouter.ts — xstockstrat-config
 * Translates n8n HTTP payloads to ConfigService gRPC calls.
 * Enables n8n workflows to trigger live config updates across all services.
 */
import express, { Request, Response } from 'express';
import { ConfigServiceImpl } from '../grpc/configServiceImpl';
import { getLogger } from '../services/logger';

const log = getLogger('config:n8n');

export function createN8nRouter(configImpl: ConfigServiceImpl) {
  const router = express.Router();

  /**
   * POST /webhooks/n8n/set-config
   * Single key update — triggers WatchConfig DELTA broadcast to all subscribers.
   */
  router.post('/set-config', async (req: Request, res: Response) => {
    const { namespace, key, value, author, reason } = req.body;
    if (!namespace || !key || !value) {
      return res.status(400).json({ error: 'namespace, key, value required' });
    }
    try {
      await new Promise<void>((resolve, reject) => {
        configImpl.setConfig(
          { request: { namespace, key, value, author: author ?? 'n8n', reason: reason ?? '' } },
          (err: any, result: any) => (err ? reject(err) : resolve()),
        );
      });
      log.info('Config updated via n8n', { namespace, key, author });
      res.json({ success: true, namespace, key });
    } catch (err: any) {
      log.error('set-config failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /webhooks/n8n/rollout
   * Atomic multi-key rollout — applies all changes, then broadcasts once per namespace.
   */
  router.post('/rollout', async (req: Request, res: Response) => {
    const { changes, author, reason } = req.body;
    if (!Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ error: 'changes[] required' });
    }
    const applied: string[] = [];
    const failed: string[] = [];
    for (const change of changes) {
      try {
        await new Promise<void>((resolve, reject) => {
          configImpl.setConfig(
            { request: { namespace: change.namespace, key: change.key, value: change.value, author: author ?? 'n8n', reason: reason ?? 'n8n rollout' } },
            (err: any) => (err ? reject(err) : resolve()),
          );
        });
        applied.push(`${change.namespace}.${change.key}`);
      } catch (err: any) {
        failed.push(`${change.namespace}.${change.key}: ${err.message}`);
      }
    }
    log.info('Config rollout via n8n', { applied_count: applied.length, failed_count: failed.length, author });
    res.json({ applied, failed });
  });

  /**
   * POST /webhooks/n8n/list-keys
   * Returns all config keys for a namespace.
   */
  router.post('/list-keys', async (req: Request, res: Response) => {
    const { namespace } = req.body;
    if (!namespace) return res.status(400).json({ error: 'namespace required' });
    configImpl.listKeys({ request: { namespace } }, (err: any, result: any) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result);
    });
  });

  return router;
}
