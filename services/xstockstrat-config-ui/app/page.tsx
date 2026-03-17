/**
 * Config UI — Namespace list dashboard.
 *
 * Fetches all known namespaces and displays them as cards with key counts.
 * Environment and trading_mode are selected globally via the EnvModeSwitcher
 * and stored in a URL search param: ?env=dev&mode=paper (defaults).
 */
import Link from 'next/link';

// Known namespaces from the platform. In production this could be fetched from the config service.
const KNOWN_NAMESPACES = [
  'platform',
  'trading',
  'portfolio',
  'marketdata',
  'indicators',
  'ingest',
  'analysis',
  'ledger',
  'identity',
  'notify',
];

type SearchParams = { env?: string; mode?: string };

export default function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const env = searchParams.env ?? 'dev';
  const mode = searchParams.mode ?? 'paper';

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-lg font-semibold">Configuration Namespaces</h1>
        <EnvModeSwitcher env={env} mode={mode} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {KNOWN_NAMESPACES.map((ns) => (
          <Link
            key={ns}
            href={`/${ns}?env=${env}&mode=${mode}`}
            className="block border border-gray-700 rounded-lg p-4 hover:border-green-500 transition-colors"
          >
            <div className="text-sm font-semibold text-green-400">{ns}</div>
            <div className="text-xs text-gray-500 mt-1">namespace</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function EnvModeSwitcher({ env, mode }: { env: string; mode: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">env:</span>
      {['dev', 'production'].map((e) => (
        <a
          key={e}
          href={`/?env=${e}&mode=${mode}`}
          className={`px-2 py-1 rounded border ${
            env === e
              ? 'border-green-500 text-green-400'
              : 'border-gray-700 text-gray-400 hover:border-gray-500'
          }`}
        >
          {e}
        </a>
      ))}
      <span className="text-gray-500 ml-2">mode:</span>
      {['paper', 'live'].map((m) => (
        <a
          key={m}
          href={`/?env=${env}&mode=${m}`}
          className={`px-2 py-1 rounded border ${
            mode === m
              ? 'border-blue-500 text-blue-400'
              : 'border-gray-700 text-gray-400 hover:border-gray-500'
          }`}
        >
          {m}
        </a>
      ))}
    </div>
  );
}
