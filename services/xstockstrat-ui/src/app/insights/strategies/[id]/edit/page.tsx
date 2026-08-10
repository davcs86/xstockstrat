'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/insights/AppShell';
import { StrategyWizard } from '@/components/insights/StrategyWizard';
import { useGetStrategy } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';

export default function EditStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: isAdmin } = useIsAdmin();
  const { data, isLoading } = useGetStrategy(id);

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6 space-y-1">
          <PageBreadcrumb
            ariaLabel="Strategy path"
            items={[
              { label: 'Strategies', href: '/insights/strategies' },
              { label: id, href: `/insights/strategies/${id}` },
              { label: 'Edit' },
            ]}
          />
          <h1 className="text-xl font-bold tracking-tight">Edit Strategy</h1>
        </div>
        {!isAdmin ? (
          <p className="text-sm text-muted-foreground">You need admin access to edit strategies.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data ? (
          <StrategyWizard
            mode="edit"
            initial={data}
            onSubmitDone={() => router.push(`/insights/strategies/${id}`)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Strategy not found.</p>
        )}
      </div>
    </AppShell>
  );
}
