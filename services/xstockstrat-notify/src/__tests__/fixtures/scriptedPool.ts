export interface PoolCall {
  sql: string;
  params: any[];
}

/** Rows a non-due SELECT returns: handed out once, minus the in-flight ids in `params[0]`. */
export interface ScriptedSelect {
  match: RegExp;
  rows: any[];
}

export interface PoolOpts {
  /** Statements matching this reject. */
  failOn?: RegExp;
  /** rowCount reported for UPDATE statements (default 1), fixed or per statement. */
  updateRowCount?: number | ((sql: string) => number);
  /** The due-select never resolves. */
  hangSelect?: boolean;
  /** Id column and table of the queue under test (default: the webhook delivery queue). */
  idColumn?: string;
  table?: string;
  /** Further SELECTs, matched before the due-select. */
  selects?: ScriptedSelect[];
  /** When set, only SELECTs matching it are the due-select; any other unscripted SELECT is empty. */
  dueMatch?: RegExp;
  /** Called with every statement, whitespace-collapsed, before it is answered. */
  onQuery?: (sql: string, params: any[]) => void;
}

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

// Scripted pool: the due-select hands out each configured row once (minus the in-flight ids and up
// to the LIMIT it is given); everything else is recorded. `connect` only counts — it must stay 0.
export function scriptedPool(dueRows: any[], opts: PoolOpts = {}) {
  const idColumn = opts.idColumn ?? 'delivery_id';
  const table = opts.table ?? 'notify.webhook_deliveries';
  const calls: PoolCall[] = [];
  let due = [...dueRows];
  const scripted = (opts.selects ?? []).map((s) => ({ match: s.match, rows: [...s.rows] }));
  let connects = 0;
  const obj = {
    async query(sql: string, params: any[] = []) {
      calls.push({ sql, params });
      opts.onQuery?.(flat(sql), params);
      if (opts.failOn?.test(sql)) throw new Error('db down');
      if (/^\s*SELECT/i.test(sql)) {
        const extra = scripted.find((s) => s.match.test(flat(sql)));
        if (extra) {
          const inFlight: string[] = Array.isArray(params[0]) ? params[0] : [];
          const rows = extra.rows.filter((r) => !inFlight.includes(r[idColumn]));
          extra.rows = extra.rows.filter((r) => !rows.includes(r));
          return { rows, rowCount: rows.length };
        }
        if (opts.dueMatch && !opts.dueMatch.test(flat(sql))) return { rows: [], rowCount: 0 };
        if (opts.hangSelect) return new Promise<never>(() => {});
        const [inFlight, limit] = params;
        const rows = due.filter((r) => !inFlight.includes(r[idColumn])).slice(0, limit);
        due = due.filter((r) => !rows.includes(r));
        return { rows, rowCount: rows.length };
      }
      if (!/^\s*UPDATE/i.test(sql)) return { rows: [], rowCount: 1 };
      const count = typeof opts.updateRowCount === 'function' ? opts.updateRowCount(flat(sql)) : opts.updateRowCount;
      return { rows: [], rowCount: count ?? 1 };
    },
    connect() {
      connects++;
      throw new Error('pool.connect must never be called');
    },
  };
  const matching = (re: RegExp) => calls.filter((c) => re.test(flat(c.sql)));
  const escaped = table.replace('.', '\\.');
  return {
    obj,
    calls,
    matching,
    /** Makes more rows due, as a later enqueue would. */
    addDue: (...rows: any[]) => {
      due.push(...rows);
    },
    connects: () => connects,
    selects: () => matching(/^SELECT/i),
    updates: () => matching(new RegExp(`^UPDATE ${escaped}`)),
    delivered: () => matching(/SET state = 'delivered'/),
    dead: () => matching(/SET state = 'dead'/),
    retried: () => matching(/make_interval\(secs => \$\d\)/),
  };
}

export function alertRecorder(fail = false) {
  const alerts: any[] = [];
  return {
    alerts,
    fn: async (alert: any) => {
      alerts.push(alert);
      if (fail) throw new Error('alert insert failed');
    },
  };
}

// setImmediate is never mocked by the suites, so this drains un-awaited work under mock timers too.
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
