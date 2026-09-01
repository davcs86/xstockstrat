'use client';

import { AppShell } from '@/components/insights/AppShell';
import { PerformanceDashboard } from '@/components/insights/PerformanceDashboard';

/**
 * feature 031 — /insights/performance strategy-performance dashboard route. The insights layout
 * already supplies the React Query provider; the client dashboard owns all data fetching + charting.
 */
export default function PerformancePage() {
  return (
    <AppShell>
      <PerformanceDashboard />
    </AppShell>
  );
}
