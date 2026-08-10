import { getNativeConfigEnv } from '@/lib/deploymentEnv';
import { NamespaceEditor } from './NamespaceEditor';

type Props = {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ env?: string; mode?: string }>;
};

export default async function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = await params;
  const resolvedSearchParams = await searchParams;
  const env = resolvedSearchParams.env ?? 'dev';
  const mode = resolvedSearchParams.mode ?? 'paper';
  const nativeEnv = getNativeConfigEnv();

  return <NamespaceEditor namespace={namespace} env={env} mode={mode} nativeEnv={nativeEnv} />;
}
