// Peer-SAN spike (feature 224, Step 5): grpc-js exposes the mTLS client's SAN to the handler via
// call.getAuthContext().sslPeerCertificate.subjectaltname. Step 21 binds the ingest GetSecret grant
// to that value. node:test over compiled JS.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as mtls from '../mtls';
import { sh, mintLeaf, setEnv } from './mtlsTestPki';

const SVC = 'xstockstrat-test';
const METHOD = '/test.Echo/Call';
const passthrough = (b: Buffer): Buffer => b;

function dnsSans(subjectaltname: string | undefined): string[] {
  return (subjectaltname ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice('DNS:'.length));
}

describe('peer SAN spike (grpc-js getAuthContext)', () => {
  let ca: string;
  let leaves: Record<string, [string, string]>;
  let server: grpc.Server;
  let port: number;
  let capturedSans: string[] | undefined;

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'san-'));
    const caPath = join(dir, 'ca.pem');
    const caKey = join(dir, 'ca-key.pem');
    sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caPath, '-days', '1', '-subj', '/CN=test-ca');
    ca = readFileSync(caPath, 'utf8');
    leaves = {
      server: mintLeaf(dir, SVC, caPath, caKey),
      ingest: mintLeaf(dir, 'xstockstrat-ingest', caPath, caKey),
      other: mintLeaf(dir, 'xstockstrat-client', caPath, caKey),
    };
    setEnv(leaves.server[0], leaves.server[1], ca);
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
          capturedSans = dnsSans(call.getAuthContext()?.sslPeerCertificate?.subjectaltname);
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

  function callAs(leaf: [string, string]): Promise<Buffer> {
    setEnv(leaf[0], leaf[1], ca);
    const client = new grpc.Client(`127.0.0.1:${port}`, mtls.clientCredentials(), mtls.targetOverride(SVC));
    return new Promise<Buffer>((resolve, reject) => {
      client.makeUnaryRequest(METHOD, passthrough, passthrough, Buffer.from('ping'), new grpc.Metadata(), (err, resp) => {
        client.close();
        return err ? reject(err) : resolve(resp as Buffer);
      });
    });
  }

  it('exposes exactly the presented client DNS SAN', async () => {
    assert.equal((await callAs(leaves.ingest)).toString(), 'ok');
    assert.deepEqual(capturedSans, ['xstockstrat-ingest']);
  });

  it('a different client leaf carries its own SAN, not the ingest one', async () => {
    assert.equal((await callAs(leaves.other)).toString(), 'ok');
    assert.deepEqual(capturedSans, ['xstockstrat-client']);
  });
});
