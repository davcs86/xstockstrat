import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingMessage } from 'http';

export interface PropagationContext {
  userId: string;
  accessScope: string;
  traceId: string;
}

export const propagationStore = new AsyncLocalStorage<PropagationContext>();

// Extract the three upstream-propagation headers from an incoming HTTP request.
// Used on the Connect-RPC HTTP path.
export function extractFromHttpRequest(req: IncomingMessage): PropagationContext {
  return {
    userId:      (req.headers['x-user-id']      as string) ?? '',
    accessScope: (req.headers['x-access-scope'] as string) ?? '0',
    traceId:     (req.headers['x-trace-id']     as string) ?? '',
  };
}
