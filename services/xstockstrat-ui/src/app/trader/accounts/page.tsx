'use client';
import { AppShell } from '@/components/trader/AppShell';
import { AccountsModule } from '@/components/trader/AccountsModule';

export default function AccountsPage() {
  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <AccountsModule />
      </div>
    </AppShell>
  );
}
