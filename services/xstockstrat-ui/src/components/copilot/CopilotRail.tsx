'use client';
import React from 'react';
import { X, Sparkle, PaperPlaneRight, Warning } from '@phosphor-icons/react';
import { useChrome } from '@/context/ChromeContext';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { ledgerClient } from '@/lib/browserClients/ledgerClient';
import {
  COPILOT_EVENT_TYPE,
  COPILOT_STREAM_PREFIX,
  COPILOT_MCP_TOOL_COUNT,
  buildQueueSummary,
  buildConcentrationFlag,
  type QueueLike,
} from '@/lib/copilot';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';

// The browser supplies a copilot-prefixed stream key; the BFF rewrites it to the per-user
// thread server-side (the client never learns the user id). Any copilot: value works.
const CLIENT_STREAM_KEY = `${COPILOT_STREAM_PREFIX}me`;

interface ThreadMessage {
  role: string;
  text: string;
  sequence: number;
}

/**
 * Copilot beta rail: two client-side templated reads (queue summary + concentration flag, no LLM)
 * and an append-only note thread replayed from the ledger. No agent tool call, no agent DB, no new pool.
 */
export function CopilotRail() {
  const { showCopilot, setShowCopilot } = useChrome();
  const [queue, setQueue] = React.useState<QueueLike[] | null>(null);
  const [thread, setThread] = React.useState<ThreadMessage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);

  const loadThread = React.useCallback(async () => {
    try {
      const resp = await ledgerClient.queryEvents({
        streamKey: CLIENT_STREAM_KEY,
        eventType: COPILOT_EVENT_TYPE,
      });
      const msgs = resp.events
        .map((e) => {
          const p = (e.payload ?? {}) as Record<string, unknown>;
          return {
            role: String(p.role ?? 'user'),
            text: String(p.text ?? ''),
            sequence: Number(e.sequence),
          };
        })
        .filter((m) => m.text)
        .sort((a, b) => a.sequence - b.sequence);
      setThread(msgs);
    } catch {
      // Non-fatal — the rail still shows the queue reads.
    }
  }, []);

  // Fetch queue + thread whenever the rail opens.
  React.useEffect(() => {
    if (!showCopilot) return;
    let cancelled = false;
    analysisClient
      .listOpportunities({})
      .then((resp) => {
        if (!cancelled) {
          setQueue(
            resp.opportunities.map((o) => ({
              symbol: o.symbol,
              action: o.action,
              conviction: o.conviction,
            })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setQueue([]);
      });
    loadThread();
    return () => {
      cancelled = true;
    };
  }, [showCopilot, loadThread]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await ledgerClient.appendEvent({
        eventType: COPILOT_EVENT_TYPE,
        streamKey: CLIENT_STREAM_KEY,
        payload: { role: 'user', text },
      });
      setDraft('');
      await loadThread();
    } catch {
      // Non-fatal — keep the draft so the user can retry.
    } finally {
      setSending(false);
    }
  };

  if (!showCopilot) return null;

  const summary = queue === null ? 'Reading the queue…' : buildQueueSummary(queue);
  const flag = queue === null ? null : buildConcentrationFlag(queue);

  return (
    <aside
      data-testid="copilot-rail"
      className="fixed right-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-[310px] flex-col border-l bg-card"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkle weight="fill" className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Copilot</span>
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
            beta
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Close copilot"
          onClick={() => setShowCopilot(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <section className="rounded-md border bg-background p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Read of the queue
          </p>
          <p className="text-sm" data-testid="copilot-queue-summary">
            {summary}
          </p>
        </section>

        {flag && (
          <Alert
            variant={flag.level === 'watch' ? 'warning' : 'default'}
            data-testid="copilot-concentration"
          >
            <AlertTitle>
              {flag.level === 'watch' && <Warning weight="fill" className="h-3.5 w-3.5" />}
              Concentration
            </AlertTitle>
            <AlertDescription>{flag.text}</AlertDescription>
          </Alert>
        )}

        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Asked earlier
          </p>
          {thread.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No notes yet. Jot a thought below — it&apos;s saved to your append-only thread.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {thread.map((m) => (
                <li
                  key={m.sequence}
                  className="rounded-md bg-muted px-2.5 py-1.5 text-sm"
                  data-testid="copilot-message"
                >
                  {m.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="border-t px-3 py-2.5">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Jot a note…"
            className="h-9"
            aria-label="Copilot note"
          />
          <Button
            type="submit"
            size="icon"
            className="h-9 w-9"
            disabled={sending}
            aria-label="Save note"
          >
            <PaperPlaneRight className="h-4 w-4" />
          </Button>
        </form>
        <p className="mt-1.5 text-[10px] text-muted-foreground" data-testid="copilot-footer">
          MCP · {COPILOT_MCP_TOOL_COUNT} tools · read-only unless you confirm
        </p>
      </div>
    </aside>
  );
}
