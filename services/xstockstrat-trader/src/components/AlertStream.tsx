'use client';
import { useEffect, useState } from 'react';

interface Alert {
  alert_id: string;
  severity: number;
  category: string;
  title: string;
  body: string;
  source_service: string;
}

const severityLabel: Record<number, string> = { 1: 'INFO', 2: 'WARN', 3: 'ERROR', 4: 'CRITICAL' };
const severityColor: Record<number, string> = {
  1: 'bg-blue-900/40 border-blue-700 text-blue-300',
  2: 'bg-yellow-900/40 border-yellow-700 text-yellow-300',
  3: 'bg-red-900/40 border-red-700 text-red-300',
  4: 'bg-red-950/60 border-red-500 text-red-200',
};

export function AlertStream() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Connect to SSE endpoint that proxies xstockstrat-notify StreamAlerts
    const es = new EventSource('/api/alerts/stream');
    es.onmessage = (e) => {
      try {
        const alert: Alert = JSON.parse(e.data);
        setAlerts((prev) => [alert, ...prev].slice(0, 50));
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, []);

  const unread = alerts.length;
  const highSeverity = alerts.filter((a) => a.severity >= 3).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative flex items-center gap-2 rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-2 text-sm transition-colors"
      >
        <span>🔔</span>
        {unread > 0 && (
          <span className={`text-xs font-bold ${highSeverity > 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 max-h-96 overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 shadow-xl z-50">
          <div className="flex items-center justify-between p-3 border-b border-gray-800">
            <span className="text-sm font-semibold">Alerts</span>
            <button
              onClick={() => { setAlerts([]); setOpen(false); }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Clear
            </button>
          </div>

          {alerts.length === 0 ? (
            <p className="p-4 text-sm text-gray-600">No alerts</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {alerts.map((a) => (
                <li key={a.alert_id} className={`p-3 border-l-2 ${severityColor[a.severity] ?? severityColor[1]}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-bold uppercase">{severityLabel[a.severity]}</span>
                    <span className="text-xs text-gray-500">{a.category}</span>
                  </div>
                  <p className="text-sm font-medium">{a.title}</p>
                  {a.body && <p className="text-xs text-gray-400 mt-0.5">{a.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
