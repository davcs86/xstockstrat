import { NotifyServiceService } from '@xstockstrat/proto/notify/v1/notify';
import type { ServiceDefinition } from '@grpc/grpc-js';

export function createNotifyServiceDefinition(): ServiceDefinition {
  return NotifyServiceService;
}
