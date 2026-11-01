// Fail-closed DB TLS resolver (feature 266). Byte-identical in five services and hash-guarded by
// services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts; edit all five copies together.
export type DbSsl = false | { rejectUnauthorized: true; ca: string };

export function resolveDbConnection(
  databaseUrl: string | undefined,
  caCert: string | undefined,
): { connectionString: string; ssl: DbSsl } {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? '');
  } catch {
    throw new Error('db-tls: DATABASE_URL is unset or invalid');
  }
  const modes = url.searchParams.getAll('sslmode');
  if (modes.length > 1) {
    throw new Error('db-tls: DATABASE_URL sets sslmode more than once');
  }
  for (const key of url.searchParams.keys()) {
    const k = key.toLowerCase();
    if ((k.startsWith('ssl') && key !== 'sslmode') || k === 'uselibpqcompat') {
      throw new Error(
        `db-tls: DATABASE_URL parameter "${key}" is not allowed; TLS is configured by DATABASE_CA_CERT`,
      );
    }
  }
  if (modes[0] === 'disable') {
    return { connectionString: databaseUrl as string, ssl: false };
  }
  if (!caCert) {
    throw new Error(
      'db-tls: DATABASE_CA_CERT is required for a TLS database connection (fail-closed); set it or use sslmode=disable',
    );
  }
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ca: caCert } };
}
