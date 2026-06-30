'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthCardShell, CredentialsForm } from '@/components/auth/AuthForm';

// FR-3: only allow redirects back into one of the known basePaths.
function safeRedirect(target: string | null): string {
  if (
    target &&
    (target.startsWith('/trader') ||
      target.startsWith('/insights') ||
      target.startsWith('/config-ui'))
  ) {
    return target;
  }
  return '/trader';
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <AuthCardShell title="xstockstrat Platform">
      <CredentialsForm
        submitLabel="Sign in"
        loadingLabel="Signing in…"
        onSuccess={() => router.push(safeRedirect(searchParams.get('redirect')))}
      />
    </AuthCardShell>
  );
}

function LoginSkeleton() {
  return (
    <AuthCardShell title="xstockstrat Platform">
      <div className="space-y-4">
        <div className="h-10 rounded-md bg-secondary animate-pulse" />
        <div className="h-10 rounded-md bg-secondary animate-pulse" />
        <div className="h-10 rounded-md bg-secondary/80 animate-pulse" />
      </div>
    </AuthCardShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
