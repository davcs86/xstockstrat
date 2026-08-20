import { getNativeConfigEnv } from '@/lib/deploymentEnv';
import { NamespaceEditor } from './NamespaceEditor';

type Props = {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ env?: string; user?: string }>;
};

export default async function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = await params;
  const resolvedSearchParams = await searchParams;
  // Feature 147: environment production/staging x optional per-user (user_id).
  const env = resolvedSearchParams.env === 'production' ? 'production' : 'staging';
  const user = resolvedSearchParams.user ?? '';
  const nativeEnv = getNativeConfigEnv();

  return <NamespaceEditor namespace={namespace} env={env} user={user} nativeEnv={nativeEnv} />;
}
