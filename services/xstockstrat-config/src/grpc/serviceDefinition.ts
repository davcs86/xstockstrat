import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(
  __dirname,
  '../../../../../packages/proto/config/v1/config.proto',
);

let _definition: grpc.ServiceDefinition | null = null;

export function createConfigServiceDefinition(): grpc.ServiceDefinition {
  if (_definition) return _definition;
  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkgDef) as any;
  _definition = proto.xstockstrat.config.v1.ConfigService.service;
  return _definition!;
}
