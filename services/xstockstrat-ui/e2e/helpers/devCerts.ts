// Per-run mTLS dev-cert minting for the e2e harness (feature 210).
//
// The BFF (webServer) now dials the mock backend over mutual TLS, pinning each backend's server
// authority to its registry service name (connectClients.ts makeTransport). The mock fronts several
// services on one port, so its server leaf carries ALL backend service names as SANs — the SAME
// production checkServerIdentity pin (SAN must include the target name) is satisfied by this superset
// cert, so e2e exercises the real verification path, not a bypass. Certs are minted fresh per run via
// openssl (no committed private keys); memoized so the config process and the in-process mock share
// one CA.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every backend service the BFF dials (connectClients.ts endpoints) + the UI client identity.
const BACKEND_SERVICES = [
  'xstockstrat-trading',
  'xstockstrat-portfolio',
  'xstockstrat-marketdata',
  'xstockstrat-notify',
  'xstockstrat-identity',
  'xstockstrat-analysis',
  'xstockstrat-config',
  'xstockstrat-ingest',
  'xstockstrat-indicators',
  'xstockstrat-ledger',
];

export interface DevCerts {
  ca: string;
  uiCert: string;
  uiKey: string;
  mockCert: string;
  mockKey: string;
}

let cached: DevCerts | undefined;

function openssl(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'pipe' });
}

function mintLeaf(
  dir: string,
  name: string,
  sans: string[],
  ca: string,
  caKey: string,
): [string, string] {
  const ext = join(dir, `${name}.ext`);
  const sanLine = sans.map((s) => `DNS:${s}`).join(',');
  writeFileSync(
    ext,
    `subjectAltName=${sanLine}\nextendedKeyUsage=serverAuth,clientAuth\nbasicConstraints=CA:FALSE\n`,
  );
  openssl(
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(dir, `${name}-key.pem`),
    '-out',
    join(dir, `${name}.csr`),
    '-subj',
    `/CN=${name}`,
  );
  openssl(
    'x509',
    '-req',
    '-in',
    join(dir, `${name}.csr`),
    '-CA',
    ca,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-out',
    join(dir, `${name}.pem`),
    '-days',
    '2',
    '-extfile',
    ext,
  );
  return [
    readFileSync(join(dir, `${name}.pem`), 'utf8'),
    readFileSync(join(dir, `${name}-key.pem`), 'utf8'),
  ];
}

export function devCerts(): DevCerts {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), 'xss-e2e-mtls-'));
  const ca = join(dir, 'ca.pem');
  const caKey = join(dir, 'ca-key.pem');
  openssl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    caKey,
    '-out',
    ca,
    '-days',
    '2',
    '-subj',
    '/CN=xstockstrat-e2e-ca',
  );
  const [uiCert, uiKey] = mintLeaf(dir, 'xstockstrat-ui', ['xstockstrat-ui'], ca, caKey);
  // One mock cert fronts every backend the BFF dials — SANs cover all target service names.
  const [mockCert, mockKey] = mintLeaf(
    dir,
    'xstockstrat-mock-backend',
    BACKEND_SERVICES,
    ca,
    caKey,
  );
  cached = { ca: readFileSync(ca, 'utf8'), uiCert, uiKey, mockCert, mockKey };
  return cached;
}
