import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
