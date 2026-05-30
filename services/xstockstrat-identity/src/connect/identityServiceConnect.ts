import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
import { ConnectError, Code } from '@connectrpc/connect';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { IdentityService } from '@xstockstrat/proto/identity/v1/identity_pb';
import type {
  AuthenticateUserRequest,
  CreateApiKeyRequest,
  ListApiKeysRequest,
  RefreshTokenRequest,
  RevokeApiKeyRequest,
  RevokeTokenRequest,
  ValidateApiKeyRequest,
  ValidateTokenRequest,
} from '@xstockstrat/proto/identity/v1/identity_pb';
import { IdentityServiceImpl } from '../grpc/identityServiceImpl';

// gRPC numeric status codes → Connect codes.
// Without this conversion the Connect framework sees a plain object and
// wraps it as Code.Internal, so callers can never distinguish e.g.
// Unauthenticated from an actual internal error.
const GRPC_TO_CONNECT: Record<number, Code> = {
  1: Code.Canceled,          2: Code.Unknown,
  3: Code.InvalidArgument, 4: Code.DeadlineExceeded,  5: Code.NotFound,
  6: Code.AlreadyExists,   7: Code.PermissionDenied,  8: Code.ResourceExhausted,
  9: Code.FailedPrecondition, 10: Code.Aborted,        11: Code.OutOfRange,
  12: Code.Unimplemented,  13: Code.Internal,          14: Code.Unavailable,
  15: Code.DataLoss,       16: Code.Unauthenticated,
};

function toConnectError(err: any): ConnectError {
  const code = GRPC_TO_CONNECT[err?.code] ?? Code.Internal;
  return new ConnectError(err?.message ?? 'internal error', code);
}

// The shared impl returns `Date` instances for Timestamp fields (the shape
// ts-proto's grpc-js serializer requires). protobuf-es, used by the Connect
// HTTP path, expects `google.protobuf.Timestamp` messages instead, so deep-walk
// the response and convert any Date before it reaches the Connect framework.
function normalizeTimestamps(value: any): any {
  if (value instanceof Date) {
    return timestampFromDate(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeTimestamps);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = normalizeTimestamps(value[key]);
    }
    return out;
  }
  return value;
}

export function createIdentityServiceConnectImpl(
  impl: IdentityServiceImpl
): ServiceImpl<typeof IdentityService> {
  return {
    async authenticateUser(req: AuthenticateUserRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.authenticateUser({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async validateToken(req: ValidateTokenRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.validateToken({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async refreshToken(req: RefreshTokenRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.refreshToken({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async revokeToken(req: RevokeTokenRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.revokeToken({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async createApiKey(req: CreateApiKeyRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.createApiKey({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async validateApiKey(req: ValidateApiKeyRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.validateApiKey({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async listApiKeys(req: ListApiKeysRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.listApiKeys({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },

    async revokeApiKey(req: RevokeApiKeyRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.revokeApiKey({ request: req }, (err: any, res: any) => {
          if (err) reject(toConnectError(err));
          else resolve(normalizeTimestamps(res));
        });
      });
    },
  };
}
