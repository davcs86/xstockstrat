'use client';
import { AppShell } from '@/components/trader/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Book → Portfolio (feature 083). Placeholder shell so the route resolves for the
 * nav-reachability test (Step 20); the real read-only broker-mirror view lands in Step 25.
 */
export default function PortfolioPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The read-only broker-mirror portfolio view lands here.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
