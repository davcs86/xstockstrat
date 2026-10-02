import { ConfigNamespaceView } from '../ConfigNamespaceView';

type Props = {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ env?: string; user?: string }>;
};

export default async function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = await params;
  const resolvedSearchParams = await searchParams;
  return (
    <ConfigNamespaceView
      namespace={namespace}
      basePath={`/config-ui/${namespace}`}
      rawEnv={resolvedSearchParams.env}
      rawUser={resolvedSearchParams.user}
    />
  );
}
