/**
 * Config UI — Audit log viewer.
 * Shows recent config changes across all namespaces.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface AuditEntry {
  id: string;
  namespace: string;
  key: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  reason: string;
  changedAt: string;
  environment: string;
  tradingMode: string;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit')
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">
          &larr; namespaces
        </Link>
        <h1 className="text-lg font-semibold">Audit Log</h1>
      </div>

      {loading && <p className="text-gray-500 text-sm">Loading...</p>}

      {!loading && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-800">
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">Namespace / Key</th>
              <th className="py-2 pr-4">Old</th>
              <th className="py-2 pr-4">New</th>
              <th className="py-2 pr-4">By</th>
              <th className="py-2 pr-4">Env / Mode</th>
              <th className="py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-900 hover:bg-gray-900/30">
                <td className="py-2 pr-4 text-gray-500 text-xs whitespace-nowrap">
                  {formatDistanceToNow(new Date(e.changedAt), { addSuffix: true })}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  <span className="text-green-400">{e.namespace}</span>
                  <span className="text-gray-500">.</span>
                  <span className="text-gray-200">{e.key}</span>
                </td>
                <td className="py-2 pr-4 text-red-400 font-mono text-xs">{e.oldValue || '—'}</td>
                <td className="py-2 pr-4 text-blue-400 font-mono text-xs">{e.newValue}</td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{e.changedBy}</td>
                <td className="py-2 pr-4 text-gray-500 text-xs">
                  {e.environment} / {e.tradingMode}
                </td>
                <td className="py-2 text-gray-500 text-xs">{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
