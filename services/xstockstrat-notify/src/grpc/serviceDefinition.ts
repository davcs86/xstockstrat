import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_PATH = path.resolve(
  __dirname,
  '../../../../../packages/proto/notify/v1/notify.proto',
);

let _definition: grpc.ServiceDefinition | null = null;

export function createNotifyServiceDefinition(): grpc.ServiceDefinition {
  if (_definition) return _definition;
  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(pkgDef) as any;
  _definition = proto.xstockstrat.notify.v1.NotifyService.service;
  return _definition!;
}
