import { ConfigServiceService } from '@xstockstrat/proto/config/v1/config';
import type { ServiceDefinition } from '@grpc/grpc-js';

export function createConfigServiceDefinition(): ServiceDefinition {
  return ConfigServiceService;
}
