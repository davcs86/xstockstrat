import { redirect } from 'next/navigation';
import { ConfigNamespaceView } from './ConfigNamespaceView';

type SearchParams = { env?: string; user?: string };

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const resolvedSearchParams = await searchParams;
  if (!resolvedSearchParams.env) {
    redirect('/config-ui?env=staging');
  }
  return (
    <ConfigNamespaceView
      namespace="platform"
      basePath="/config-ui"
      rawEnv={resolvedSearchParams.env}
      rawUser={resolvedSearchParams.user}
    />
  );
}
