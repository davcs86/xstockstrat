'use client';
import { useEffect, useRef, useState } from 'react';
import { errMessage } from '@/lib/errMessage';
import { STREAM_STABLE_MS, isRetryableStreamError, nextBackoffMs } from '@/lib/streamBackoff';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// Re-subscribes only when `key` changes; `open`/`onItem` may change identity on every render.
// A terminal (non-retryable) error stops reconnecting for good and is reported as `terminal`.
export function useReconnectingStream<T>(
  key: string,
  open: (signal: AbortSignal) => AsyncIterable<T>,
  onItem: (item: T) => void,
): { disconnected: boolean; terminal: string | null } {
  const [disconnected, setDisconnected] = useState(false);
  const [terminal, setTerminal] = useState<string | null>(null);
  const openRef = useRef(open);
  const onItemRef = useRef(onItem);
  openRef.current = open;
  onItemRef.current = onItem;

  useEffect(() => {
    const ctrl = new AbortController();
    setTerminal(null);
    (async () => {
      let attempt = 0;
      while (!ctrl.signal.aborted) {
        const stable = setTimeout(() => {
          setDisconnected(false);
          attempt = 0;
        }, STREAM_STABLE_MS);
        try {
          for await (const item of openRef.current(ctrl.signal)) {
            setDisconnected(false);
            attempt = 0;
            onItemRef.current(item);
          }
        } catch (err) {
          if (ctrl.signal.aborted) return;
          if (!isRetryableStreamError(err)) {
            setTerminal(errMessage(err));
            setDisconnected(true);
            return;
          }
        } finally {
          clearTimeout(stable);
        }
        if (ctrl.signal.aborted) return;
        setDisconnected(true);
        await sleep(nextBackoffMs(attempt++), ctrl.signal);
      }
    })();
    return () => ctrl.abort();
  }, [key]);

  return { disconnected, terminal };
}
