import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';

import * as mtls from '../mtls';

export function sh(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'pipe' });
}

export function mintLeaf(dir: string, name: string, ca: string, caKey: string): [string, string] {
  const ext = join(dir, `${name}.ext`);
  writeFileSync(ext, `subjectAltName=DNS:${name}\nextendedKeyUsage=serverAuth,clientAuth\n`);
  sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `${name}-key.pem`), '-out', join(dir, `${name}.csr`), '-subj', `/CN=${name}`);
  sh('x509', '-req', '-in', join(dir, `${name}.csr`), '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', join(dir, `${name}.pem`), '-days', '1', '-extfile', ext);
  return [readFileSync(join(dir, `${name}.pem`), 'utf8'), readFileSync(join(dir, `${name}-key.pem`), 'utf8')];
}

export function setEnv(cert: string, key: string, ca: string): void {
  process.env.MTLS_CERT = cert;
  process.env.MTLS_KEY = key;
  process.env.MTLS_CA_CERT = ca;
}

// mtls.* read MTLS_* env at call time, so setEnv must run right before each credential factory call.
export async function startMtlsLoopback(
  server: grpc.Server,
  clientNames: string[],
): Promise<{ port: number; clients: Record<string, grpc.ChannelCredentials> }> {
  const dir = mkdtempSync(join(tmpdir(), 'config-mtls-'));
  const ca = join(dir, 'ca.pem');
  const caKey = join(dir, 'ca-key.pem');
  sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '1', '-subj', '/CN=test-ca');
  const caPem = readFileSync(ca, 'utf8');
  const serverLeaf = mintLeaf(dir, 'xstockstrat-config', ca, caKey);
  const leaves = clientNames.map((name) => [name, mintLeaf(dir, name, ca, caKey)] as const);

  setEnv(...serverLeaf, caPem);
  const port: number = await new Promise((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', mtls.serverCredentials(), (e, p) => (e ? reject(e) : resolve(p))),
  );
  const clients: Record<string, grpc.ChannelCredentials> = {};
  for (const [name, leaf] of leaves) {
    setEnv(...leaf, caPem);
    clients[name] = mtls.clientCredentials();
  }
  return { port, clients };
}
