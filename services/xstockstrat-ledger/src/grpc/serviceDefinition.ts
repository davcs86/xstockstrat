import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(
  __dirname,
  '../../../../../packages/proto/ledger/v1/ledger.proto',
);

let _definition: grpc.ServiceDefinition | null = null;

export function createLedgerServiceDefinition(): grpc.ServiceDefinition {
  if (_definition) return _definition;
  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkgDef) as any;
  _definition = proto.xstockstrat.ledger.v1.LedgerService.service;
  return _definition!;
}
