export interface FetchCall {
  url: string;
  init: any;
}

/** What one stubbed call does: answer, throw, or stay open until the request's signal aborts. */
export type FetchReply =
  | { status: number; headers?: Record<string, string>; type?: string; body?: string }
  | { throws: Error }
  | { hang: true };

export type FetchResponder = (call: FetchCall, index: number) => FetchReply;

export interface FetchStub {
  calls: FetchCall[];
  /** Times a response body was read (text / json / reader) and cancelled, across all calls. */
  bodyReads: () => number;
  bodyCancels: () => number;
  restore: () => void;
}

export function abortError(): Error {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

/** The shape Node's fetch rejects with on a socket failure: TypeError with a coded cause. */
export function networkError(code: string, message = 'fetch failed'): Error {
  return Object.assign(new TypeError(message), { cause: Object.assign(new Error(code), { code }) });
}

export function stubFetch(reply: number | FetchResponder = 200): FetchStub {
  const calls: FetchCall[] = [];
  let reads = 0;
  let cancels = 0;
  const responder: FetchResponder = typeof reply === 'number' ? () => ({ status: reply }) : reply;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const call = { url: String(url), init };
    calls.push(call);
    const r = responder(call, calls.length - 1);
    if ('throws' in r) throw r.throws;
    if ('hang' in r) {
      return new Promise((_, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (signal?.aborted) return reject(abortError());
        signal?.addEventListener('abort', () => reject(abortError()));
      });
    }
    const read = async () => {
      reads++;
      return r.body ?? '';
    };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      type: r.type ?? 'basic',
      headers: { get: (name: string) => r.headers?.[name.toLowerCase()] ?? null },
      text: read,
      json: async () => JSON.parse(await read()),
      body: {
        cancel: async () => {
          cancels++;
        },
        getReader: () => {
          reads++;
          throw new Error('response body must not be read');
        },
      },
    } as any;
  }) as any;
  return {
    calls,
    bodyReads: () => reads,
    bodyCancels: () => cancels,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
