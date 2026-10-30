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
    // EventEmitter-compatible: removeListener(e, cb) also drops a once(e, cb) wrapper.
    once(event: string, cb: (...a: any[]) => void) {
      const wrapper = Object.assign(
        (...a: any[]) => {
          this.removeListener(event, wrapper);
          cb(...a);
        },
        { listener: cb },
      );
      return this.on(event, wrapper);
    },
    removeListener(event: string, cb: (...a: any[]) => void) {
      const list = this.handlers[event] || [];
      const i = list.findIndex((h: any) => h === cb || h.listener === cb);
      if (i >= 0) list.splice(i, 1);
      return this;
    },
    emit(event: string, ...args: any[]) {
      const list = (this.handlers[event] || []).slice();
      for (const h of list) h(...args);
      return list.length > 0;
    },
  };
}
