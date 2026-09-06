// Canonical native-scope resolution for the Config UI's ENV axis. Reads APPLICATION_ENV and
// normalizes "development"/"production" to the Config UI's "staging"/"production" vocabulary.
// Server-Components-only — APPLICATION_ENV is not in the client bundle, so a Client Component must
// receive the resolved value as a prop.
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';

export function getNativeConfigEnv(): 'staging' | 'production' {
  return process.env.APPLICATION_ENV === 'production' ? 'production' : 'staging';
}

/** This deployment's native scope as the proto Environment enum — so a server-side caller can fill an
 * UNSPECIFIED environment with the correct native value instead of threading it as a prop. */
export function nativeConfigEnvironment(): Environment {
  return getNativeConfigEnv() === 'production' ? Environment.PRODUCTION : Environment.STAGING;
}

/**
 * True when `env` matches this deployment's native scope. UNSPECIFIED and the deprecated DEV both
 * resolve to STAGING before comparing (mirrors the backend's ENV_MAP) — an exact-match would falsely
 * reject a legitimate write on a staging-native deployment.
 */
export function isNativeConfigEnvironment(env: Environment): boolean {
  const effective =
    env === Environment.UNSPECIFIED || env === Environment.DEV ? Environment.STAGING : env;
  const nativeProtoEnv =
    getNativeConfigEnv() === 'production' ? Environment.PRODUCTION : Environment.STAGING;
  return effective === nativeProtoEnv;
}
