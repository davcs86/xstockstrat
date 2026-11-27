'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCardShell, CredentialsForm } from '@/components/auth/AuthForm';
import { Skeleton } from '@/components/ui/skeleton';
import { safeRedirect } from '@/lib/safeRedirect';

// `children` renders above the password form inside the same card (the SSO form and notices).
export function LoginForm({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <AuthCardShell title="xstockstrat Platform">
      {children}
      <CredentialsForm
        submitLabel="Sign in"
        loadingLabel="Signing in…"
        showRememberMe
        onSuccess={() => router.push(safeRedirect(searchParams.get('redirect')))}
      />
    </AuthCardShell>
  );
}

export function LoginSkeleton() {
  return (
    <AuthCardShell title="xstockstrat Platform">
      <div className="space-y-4">
        <Skeleton className="h-10 bg-secondary" />
        <Skeleton className="h-10 bg-secondary" />
        <Skeleton className="h-10 bg-secondary/80" />
      </div>
    </AuthCardShell>
  );
}
