/**
 * Config UI — Key-value table for a given namespace.
 * Fetches config keys from the API route (which calls xstockstrat-config via Connect-RPC).
 * Allows inline editing of non-secret values.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ConfigKey {
  key: string;
  description: string;
  defaultValue: string;
  isSecret: boolean;
  consumingService: string;
  environment: number;
  tradingMode: number;
}

interface ListKeysResponse {
  keys: ConfigKey[];
}

type Props = {
  params: { namespace: string };
  searchParams: { env?: string; mode?: string };
};

export default function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = params;
  const env = searchParams.env ?? 'dev';
  const mode = searchParams.mode ?? 'paper';

  const [keys, setKeys] = useState<ConfigKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/config?namespace=${namespace}&env=${env}&mode=${mode}`)
      .then((r) => r.json())
      .then((data: ListKeysResponse) => {
        setKeys(data.keys ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [namespace, env, mode]);

  async function handleSave(key: string) {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace,
          key,
          value: editValue,
          env,
          mode,
          author: 'config-ui',
          reason: 'Updated via config-ui',
        }),
      });
      setEditingKey(null);
      // Refresh
      const data: ListKeysResponse = await fetch(
        `/api/config?namespace=${namespace}&env=${env}&mode=${mode}`
      ).then((r) => r.json());
      setKeys(data.keys ?? []);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/?env=${env}&mode=${mode}`} className="text-gray-500 hover:text-gray-300 text-sm">
          &larr; namespaces
        </Link>
        <h1 className="text-lg font-semibold">
          <span className="text-green-400">{namespace}</span>
          <span className="text-gray-500 text-sm ml-2">
            env: {env} &middot; mode: {mode}
          </span>
        </h1>
      </div>

      {loading && <p className="text-gray-500 text-sm">Loading...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && !error && (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-800">
              <th className="py-2 pr-4">Key</th>
              <th className="py-2 pr-4">Value</th>
              <th className="py-2 pr-4">Description</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.key} className="border-b border-gray-900 hover:bg-gray-900/30">
                <td className="py-2 pr-4 text-green-400 font-mono">{k.key}</td>
                <td className="py-2 pr-4 font-mono">
                  {editingKey === k.key ? (
                    <input
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:border-green-500"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoFocus
                    />
                  ) : k.isSecret ? (
                    <span className="text-gray-600">[secret]</span>
                  ) : (
                    <span className="text-gray-300">{k.defaultValue || '—'}</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-gray-500 text-xs">{k.description}</td>
                <td className="py-2">
                  {!k.isSecret && editingKey !== k.key && (
                    <button
                      onClick={() => { setEditingKey(k.key); setEditValue(k.defaultValue); }}
                      className="text-xs text-blue-400 hover:text-blue-300 mr-3"
                    >
                      edit
                    </button>
                  )}
                  {editingKey === k.key && (
                    <>
                      <button
                        onClick={() => handleSave(k.key)}
                        disabled={saving}
                        className="text-xs text-green-400 hover:text-green-300 mr-3 disabled:opacity-50"
                      >
                        {saving ? 'saving...' : 'save'}
                      </button>
                      <button
                        onClick={() => setEditingKey(null)}
                        className="text-xs text-gray-500 hover:text-gray-400"
                      >
                        cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
