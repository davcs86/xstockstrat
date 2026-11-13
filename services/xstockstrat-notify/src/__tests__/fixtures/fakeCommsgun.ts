import type { KeyKind, WorkerRoute } from '../../fanout/emailProvider';

export interface FakeCommsgunOpts {
  keyKind?: KeyKind;
  route?: WorkerRoute;
  /** What `enqueue` does: resolve (default), reject, or never settle. */
  enqueue?: 'resolve' | 'reject' | 'hang';
}

/** Stand-in for the dispatcher's commsgun dependency; `box` can be changed between calls. */
export function fakeCommsgun(opts: FakeCommsgunOpts = {}) {
  const box = { keyKind: opts.keyKind ?? 'key', route: opts.route ?? 'attempt', enqueue: opts.enqueue ?? 'resolve' };
  const enqueued: Array<{ alertId: string; recipient: string; subject: string; text: string }> = [];
  return {
    box,
    enqueued,
    keyKind: (): KeyKind => box.keyKind,
    route: (): WorkerRoute => box.route,
    enqueue(email: { alertId: string; recipient: string; subject: string; text: string }): Promise<void> {
      enqueued.push(email);
      if (box.enqueue === 'hang') return new Promise<void>(() => {});
      // The message quotes the recipient, as a database error could: it must never reach a log.
      if (box.enqueue === 'reject') return Promise.reject(new Error(`insert failed for ${email.recipient}`));
      return Promise.resolve();
    },
  };
}
