import { getNativeConfigEnv } from '@/lib/deploymentEnv';
import { NamespaceEditor } from './NamespaceEditor';
import { resolveConfigScope } from '../scope';

type Props = {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ env?: string; user?: string }>;
};

export default async function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = await params;
  const resolvedSearchParams = await searchParams;
  // Environment production/staging x optional per-user (user_id).
  const env = resolvedSearchParams.env === 'production' ? 'production' : 'staging';
  // Per-user config is owner-only self-service: clamp the scope to the caller's own id, so a
  // hand-edited `?user=<someone-else>` cannot target another user's overrides here.
  const { user } = await resolveConfigScope(resolvedSearchParams.user ?? '');
  const nativeEnv = getNativeConfigEnv();

  return <NamespaceEditor namespace={namespace} env={env} user={user} nativeEnv={nativeEnv} />;
}
