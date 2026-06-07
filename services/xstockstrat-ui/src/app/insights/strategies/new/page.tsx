'use client';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/insights/AppShell';
import { StrategyWizard } from '@/components/insights/StrategyWizard';
import { useIsAdmin } from '@/hooks/useLiveStrategies';

export default function NewStrategyPage() {
  const router = useRouter();
  const { data: isAdmin } = useIsAdmin();

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">New Strategy</h1>
        </div>
        {isAdmin ? (
          <StrategyWizard
            mode="create"
            onSubmitDone={(id) => router.push(`/insights/strategies/${id}`)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            You need admin access to create strategies.
          </p>
        )}
      </div>
    </AppShell>
  );
}
