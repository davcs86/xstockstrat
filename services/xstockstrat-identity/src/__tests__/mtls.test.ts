// In-process mutual-TLS handshake + negative matrix + propagation tests (feature 210, Step 8).
// Self-contained: mints a CA + leaves via openssl in a tmp dir, stands up an in-process grpc-js
// server with mtls.serverCredentials(), and exercises the handshake over a generic echo method.
// Covers @AC-1 (plaintext refused), @AC-2 (mutual accept), @AC-4 (fail-closed boot),
// @AC-5 (trio propagated), negative matrix (wrong-CA + wrong-SAN). node:test over compiled JS.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as mtls from '../mtls';

const SVC = 'xstockstrat-test';
const METHOD = '/test.Echo/Call';
const passthrough = (b: Buffer): Buffer => b;

function sh(...args: string[]): void {
  execFileSync('openssl', args, { stdio: 'pipe' });
}

interface Pki {
  ca: string;
  serverCert: string;
  serverKey: string;
  clientCert: string;
  clientKey: string;
  foreignCert: string;
  foreignKey: string;
}

function mintLeaf(dir: string, name: string, ca: string, caKey: string): [string, string] {
  const ext = join(dir, `${name}.ext`);
  writeFileSync(ext, `subjectAltName=DNS:${name}\nextendedKeyUsage=serverAuth,clientAuth\n`);
  sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `${name}-key.pem`), '-out', join(dir, `${name}.csr`), '-subj', `/CN=${name}`);
  sh('x509', '-req', '-in', join(dir, `${name}.csr`), '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', join(dir, `${name}.pem`), '-days', '1', '-extfile', ext);
  return [readFileSync(join(dir, `${name}.pem`), 'utf8'), readFileSync(join(dir, `${name}-key.pem`), 'utf8')];
}

function mintPki(): Pki {
  const dir = mkdtempSync(join(tmpdir(), 'mtls-'));
  const ca = join(dir, 'ca.pem');
  const caKey = join(dir, 'ca-key.pem');
  sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', ca, '-days', '1', '-subj', '/CN=test-ca');
  const [serverCert, serverKey] = mintLeaf(dir, SVC, ca, caKey);
  const [clientCert, clientKey] = mintLeaf(dir, 'xstockstrat-client', ca, caKey);
  const fca = join(dir, 'fca.pem');
  const fcaKey = join(dir, 'fca-key.pem');
  sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', fcaKey, '-out', fca, '-days', '1', '-subj', '/CN=foreign-ca');
  const [foreignCert, foreignKey] = mintLeaf(dir, 'xstockstrat-client', fca, fcaKey);
  return { ca: readFileSync(ca, 'utf8'), serverCert, serverKey, clientCert, clientKey, foreignCert, foreignKey };
}

function setEnv(cert: string, key: string, ca: string): void {
  process.env.MTLS_CERT = cert;
  process.env.MTLS_KEY = key;
  process.env.MTLS_CA_CERT = ca;
}

describe('inter-service mTLS', () => {
  let pki: Pki;
  let server: grpc.Server;
  let port: number;
  let capturedMd: grpc.Metadata | undefined;

  before(async () => {
    pki = mintPki();
    setEnv(pki.serverCert, pki.serverKey, pki.ca);
    server = new grpc.Server();
    server.addService(
      {
        echo: {
          path: METHOD,
          requestStream: false,
          responseStream: false,
          requestSerialize: passthrough,
          requestDeserialize: passthrough,
          responseSerialize: passthrough,
          responseDeserialize: passthrough,
        },
      },
      {
        echo: (call: grpc.ServerUnaryCall<Buffer, Buffer>, cb: grpc.sendUnaryData<Buffer>) => {
          capturedMd = call.metadata;
          cb(null, Buffer.from('ok'));
        },
      },
    );
    port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', mtls.serverCredentials(), (err, p) => (err ? reject(err) : resolve(p)));
    });
  });

  after(() => {
    server?.forceShutdown();
  });

  function call(creds: grpc.ChannelCredentials, opts: grpc.ChannelOptions, md: grpc.Metadata): Promise<Buffer> {
    setEnv(pki.clientCert, pki.clientKey, pki.ca);
    const client = new grpc.Client(`127.0.0.1:${port}`, creds, opts);
    return new Promise<Buffer>((resolve, reject) => {
      client.makeUnaryRequest(METHOD, passthrough, passthrough, Buffer.from('ping'), md, (err, resp) =>
        err ? reject(err) : resolve(resp as Buffer),
      );
    });
  }

  it('@AC-4: fails closed when MTLS_* env is absent', () => {
    const saved = { c: process.env.MTLS_CERT, k: process.env.MTLS_KEY, a: process.env.MTLS_CA_CERT };
    delete process.env.MTLS_CERT;
    delete process.env.MTLS_KEY;
    delete process.env.MTLS_CA_CERT;
    assert.throws(() => mtls.serverCredentials());
    assert.throws(() => mtls.clientCredentials());
    setEnv(saved.c ?? '', saved.k ?? '', saved.a ?? '');
  });

  it('@AC-2 + @AC-5: mutual handshake succeeds and the trio propagates', async () => {
    const md = new grpc.Metadata();
    md.set('x-user-id', 'u-1');
    md.set('x-access-scope', '7');
    md.set('x-trace-id', 't-1');
    const resp = await call(mtls.clientCredentials(), mtls.targetOverride(SVC), md);
    assert.equal(resp.toString(), 'ok');
    assert.equal(capturedMd?.get('x-user-id')[0], 'u-1');
    assert.equal(capturedMd?.get('x-access-scope')[0], '7');
    assert.equal(capturedMd?.get('x-trace-id')[0], 't-1');
  });

  it('@AC-1: a plaintext client is refused', async () => {
    await assert.rejects(call(grpc.credentials.createInsecure(), {}, new grpc.Metadata()));
  });

  it('negative matrix (wrong-CA): a foreign-CA client cert is rejected', async () => {
    setEnv(pki.foreignCert, pki.foreignKey, pki.ca);
    const creds = mtls.clientCredentials();
    await assert.rejects(call(creds, mtls.targetOverride(SVC), new grpc.Metadata()));
  });

  it('negative matrix (wrong-SAN): a valid-CA cert pinned to the wrong name is rejected', async () => {
    await assert.rejects(call(mtls.clientCredentials(), mtls.targetOverride('xstockstrat-wrong'), new grpc.Metadata()));
  });
});
