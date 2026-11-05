import { ConnectError } from '@connectrpc/connect';

export function errMessage(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : (err as Error).message;
}
