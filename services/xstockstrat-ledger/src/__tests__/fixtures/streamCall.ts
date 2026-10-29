// Canonical recording server-streaming call double (C-13); catalogued in ./INVENTORY.md.

// A string `opts` is the caller's x-user-id (the legacy positional form).
export function makeRecordingCall(
  req: any,
  opts?: string | { userId?: string; writeReturns?: boolean },
) {
  const o = typeof opts === 'string' ? { userId: opts } : (opts ?? {});
  const userId = o.userId;
  return {
    request: req,
    metadata: { get: (k: string) => (k === 'x-user-id' && userId ? [userId] : []) },
    writes: [] as any[],
    ended: false,
    destroyed: null as any,
    handlers: {} as Record<string, Array<(...a: any[]) => void>>,
    write(msg: any) {
      this.writes.push(msg);
      return o.writeReturns ?? true;
    },
    end() {
      this.ended = true;
    },
    destroy(err: any) {
      this.destroyed = err;
    },
    on(event: string, cb: (...a: any[]) => void) {
      (this.handlers[event] ||= []).push(cb);
      return this;
    },
  };
}
