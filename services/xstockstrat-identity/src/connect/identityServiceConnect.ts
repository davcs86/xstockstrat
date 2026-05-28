import type { HandlerContext, ServiceImpl } from '@connectrpc/connect';
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

export function createIdentityServiceConnectImpl(
  impl: IdentityServiceImpl
): ServiceImpl<typeof IdentityService> {
  return {
    async authenticateUser(req: AuthenticateUserRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.authenticateUser({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async validateToken(req: ValidateTokenRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.validateToken({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async refreshToken(req: RefreshTokenRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.refreshToken({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async revokeToken(req: RevokeTokenRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.revokeToken({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async createApiKey(req: CreateApiKeyRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.createApiKey({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async validateApiKey(req: ValidateApiKeyRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.validateApiKey({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async listApiKeys(req: ListApiKeysRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.listApiKeys({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },

    async revokeApiKey(req: RevokeApiKeyRequest, _ctx: HandlerContext) {
      return new Promise<any>((resolve, reject) => {
        impl.revokeApiKey({ request: req }, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    },
  };
}
