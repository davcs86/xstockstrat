'use client';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Decide → Opportunities (feature 083). Placeholder shell so the route resolves for the
 * nav-reachability test (Step 20); the real ranked opportunity queue lands in Step 22,
 * consuming analysis.ListOpportunities.
 */
export default function OpportunitiesPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The ranked opportunity queue lands here.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
