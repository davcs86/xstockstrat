// Canonical native-scope resolution for the Config UI's ENV axis (feature 115). Reads
// APPLICATION_ENV (existing deployment env var — .do/app.yaml:26-27 / .do/app.dev.yaml:26-27)
// and normalizes its "development"/"production" vocabulary to the Config UI's own
// "dev"/"production" vocabulary (services/xstockstrat-config/migrations/002_config_environment.up.sql:8).
// Consumed by the BFF write guard (configUiBff.ts) and by Server Components only —
// APPLICATION_ENV is not exposed to the client bundle (next.config.js has no env/
// publicRuntimeConfig key for it); a Client Component must receive the resolved value as a prop.
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';

export function getNativeConfigEnv(): 'dev' | 'production' {
  return process.env.APPLICATION_ENV === 'production' ? 'production' : 'dev';
}

/**
 * True when `env` (a SetConfigRequest/ListKeysRequest environment field) matches this
 * deployment's native scope. Environment.UNSPECIFIED resolves to Environment.DEV before
 * comparing, mirroring the backend's own resolveEnv/ENV_MAP
 * (services/xstockstrat-config/src/grpc/configServiceImpl.ts:22,87-92) — an unconditional
 * exact-match would falsely reject a legitimate write on a dev-native deployment.
 */
export function isNativeConfigEnvironment(env: Environment): boolean {
  const effective = env === Environment.UNSPECIFIED ? Environment.DEV : env;
  const nativeProtoEnv =
    getNativeConfigEnv() === 'production' ? Environment.PRODUCTION : Environment.DEV;
  return effective === nativeProtoEnv;
}
