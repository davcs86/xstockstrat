// Canonical native-scope resolution for the Config UI's ENV axis (feature 115). Reads
// APPLICATION_ENV (existing deployment env var — .do/app.yaml / .do/app.dev.yaml) and normalizes
// its "development"/"production" vocabulary to the Config UI's own "staging"/"production"
// vocabulary (feature 147 renamed dev→staging; paper/live is derived from environment).
// Consumed by the BFF write guard (configUiBff.ts) and by Server Components only —
// APPLICATION_ENV is not exposed to the client bundle (next.config.js has no env/
// publicRuntimeConfig key for it); a Client Component must receive the resolved value as a prop.
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';

export function getNativeConfigEnv(): 'staging' | 'production' {
  return process.env.APPLICATION_ENV === 'production' ? 'production' : 'staging';
}

/**
 * True when `env` (a SetConfigRequest/ListKeysRequest environment field) matches this
 * deployment's native scope. Environment.UNSPECIFIED and the deprecated Environment.DEV both
 * resolve to STAGING before comparing, mirroring the backend's own resolveEnv/ENV_MAP
 * (feature 147: DEV and STAGING are the same 'staging' scope) — an unconditional exact-match
 * would falsely reject a legitimate write on a staging-native deployment.
 */
export function isNativeConfigEnvironment(env: Environment): boolean {
  const effective =
    env === Environment.UNSPECIFIED || env === Environment.DEV ? Environment.STAGING : env;
  const nativeProtoEnv =
    getNativeConfigEnv() === 'production' ? Environment.PRODUCTION : Environment.STAGING;
  return effective === nativeProtoEnv;
}
