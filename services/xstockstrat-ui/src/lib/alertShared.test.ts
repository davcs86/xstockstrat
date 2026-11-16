import { describe, expect, it } from 'vitest';
import {
  ALERT_STREAM_001,
  DRAWER_ALERT_BASE_SECONDS,
  DRAWER_ALERT_CLEAR_A,
  DRAWER_ALERT_STORED_UNREAD,
  DRAWER_ALERT_STREAMED,
} from '../../e2e/fixtures/alerts';
import {
  drainUnread,
  mergeUnread,
  pruneStreamed,
  UNREAD_PAGE_SIZE,
  type UnreadLike,
} from './alertShared';

type Fixture = { alertId: string; createdAt: string };
type TestAlert = UnreadLike & { title?: string };

function toUnread<F extends Fixture>(f: F) {
  return { ...f, createdAt: { seconds: BigInt(Date.parse(f.createdAt) / 1000), nanos: 0 } };
}

const STORED = toUnread(DRAWER_ALERT_STORED_UNREAD);
const STREAMED = toUnread(DRAWER_ALERT_STREAMED);
const CLEAR_A = toUnread(DRAWER_ALERT_CLEAR_A);

function alertAt(id: string, seconds: number): TestAlert {
  return { ...CLEAR_A, alertId: id, createdAt: { seconds: BigInt(seconds), nanos: 0 } };
}

// `count` alerts, one second apart, the newest at `newestSeconds`.
function generate(prefix: string, count: number, newestSeconds: number): TestAlert[] {
  return Array.from({ length: count }, (_, i) => alertAt(`${prefix}-${i}`, newestSeconds - i));
}

// In-memory notify: `list` returns the newest `limit` unmarked rows, `mark` records ids.
function fakeServer(alerts: TestAlert[], opts: { phantom?: boolean; failMarkCall?: number } = {}) {
  const read = new Set<string>();
  const sorted = [...alerts].sort(
    (a, b) => Number(b.createdAt!.seconds) - Number(a.createdAt!.seconds),
  );
  let listCalls = 0;
  let markCalls = 0;
  return {
    read,
    get listCalls() {
      return listCalls;
    },
    list: async (req: { unreadOnly: true; limit: number }) => {
      listCalls++;
      return { alerts: sorted.filter((a) => !read.has(a.alertId)).slice(0, req.limit) };
    },
    mark: async (req: { alertIds: string[] }) => {
      markCalls++;
      if (markCalls === opts.failMarkCall) throw new Error('mark failed');
      if (!opts.phantom) req.alertIds.forEach((id) => read.add(id));
      return {};
    },
  };
}

describe('mergeUnread', () => {
  it('@AC-9 an alert both stored and streamed appears once', () => {
    const merged = mergeUnread([STORED, STREAMED], [STREAMED], new Set());
    expect(merged.map((a) => a.alertId)).toEqual([STREAMED.alertId, STORED.alertId]);
  });

  it('drops ids in readIds', () => {
    const merged = mergeUnread([STORED, CLEAR_A], [], new Set([CLEAR_A.alertId]));
    expect(merged.map((a) => a.alertId)).toEqual([STORED.alertId]);
  });

  it('@AC-5 lists newest first — the streamed alert before the stored one', () => {
    const merged = mergeUnread([STORED], [STREAMED], new Set());
    expect(merged.map((a) => a.title)).toEqual(['Order rejected', 'Backfill 67276d1f failed']);
  });

  it('puts an alert with no timestamp first', () => {
    const merged = mergeUnread<TestAlert>([STORED, STREAMED], [ALERT_STREAM_001], new Set());
    expect(merged.map((a) => a.alertId)).toEqual([
      ALERT_STREAM_001.alertId,
      STREAMED.alertId,
      STORED.alertId,
    ]);
  });
});

describe('pruneStreamed', () => {
  it('keeps entries in the result or streamed since the fetch began, drops the rest', () => {
    const inResult = { alert: STORED, seq: 1 };
    const afterFetch = { alert: STREAMED, seq: 5 };
    const stale = { alert: CLEAR_A, seq: 4 };
    const kept = pruneStreamed([inResult, afterFetch, stale], new Set([STORED.alertId]), 5);
    expect(kept).toEqual([inResult, afterFetch]);
  });
});

describe('drainUnread', () => {
  const BASE = DRAWER_ALERT_BASE_SECONDS;

  it('@AC-10 marks 120 eligible alerts over three list calls and returns done', async () => {
    const alerts = generate('a', 120, BASE);
    const server = fakeServer(alerts);
    const result = await drainUnread({ list: server.list, mark: server.mark, cutoff: alerts[0] });
    expect(result.outcome).toBe('done');
    expect(result.markedIds).toHaveLength(120);
    expect(server.read.size).toBe(120);
    expect(server.listCalls).toBe(3);
  });

  it('@AC-10 two eligible alerts finish after exactly one list call', async () => {
    const server = fakeServer([CLEAR_A, STORED]);
    const result = await drainUnread({ list: server.list, mark: server.mark, cutoff: CLEAR_A });
    expect(result).toEqual({ markedIds: [CLEAR_A.alertId, STORED.alertId], outcome: 'done' });
    expect(server.listCalls).toBe(1);
  });

  it('@AC-10 returns capped at maxBatches', async () => {
    const alerts = generate('a', 150, BASE);
    const server = fakeServer(alerts);
    const result = await drainUnread({
      list: server.list,
      mark: server.mark,
      cutoff: alerts[0],
      maxBatches: 2,
    });
    expect(result.outcome).toBe('capped');
    expect(result.markedIds).toHaveLength(2 * UNREAD_PAGE_SIZE);
  });

  it('@AC-10 returns error with the ids marked before the failing batch', async () => {
    const alerts = generate('a', 120, BASE);
    const server = fakeServer(alerts, { failMarkCall: 2 });
    const result = await drainUnread({ list: server.list, mark: server.mark, cutoff: alerts[0] });
    expect(result.outcome).toBe('error');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.markedIds).toEqual(alerts.slice(0, UNREAD_PAGE_SIZE).map((a) => a.alertId));
  });

  it('@AC-10 leaves alerts newer than the cutoff unread and marks a tie', async () => {
    const cutoff = alertAt('cutoff', BASE);
    const tie = alertAt('tie', BASE);
    const newer = alertAt('newer', BASE + 60);
    const older = alertAt('older', BASE - 10);
    const server = fakeServer([newer, cutoff, tie, older]);
    const result = await drainUnread({ list: server.list, mark: server.mark, cutoff });
    expect(result.outcome).toBe('done');
    expect([...result.markedIds].sort()).toEqual(['cutoff', 'older', 'tie']);
    expect(server.read.has('newer')).toBe(false);
  });

  it('returns capped with nothing marked when a full page is newer than the cutoff', async () => {
    const newer = generate('new', UNREAD_PAGE_SIZE, BASE + 1000);
    const eligible = generate('old', 10, BASE);
    const server = fakeServer([...newer, ...eligible]);
    const result = await drainUnread({ list: server.list, mark: server.mark, cutoff: eligible[0] });
    expect(result).toEqual({ markedIds: [], outcome: 'capped' });
    expect(server.listCalls).toBe(1);
  });

  it('returns capped on the second pass when marks remove nothing (phantom ids)', async () => {
    const alerts = generate('a', 60, BASE);
    const server = fakeServer(alerts, { phantom: true });
    const result = await drainUnread({ list: server.list, mark: server.mark, cutoff: alerts[0] });
    expect(result.outcome).toBe('capped');
    expect(result.markedIds).toHaveLength(UNREAD_PAGE_SIZE);
    expect(server.listCalls).toBe(2);
  });
});
