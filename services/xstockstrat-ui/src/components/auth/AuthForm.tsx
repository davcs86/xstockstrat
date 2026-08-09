'use client';

// Shared login UI for the standard login page and the OAuth agent-authorize page. The card
// shell, the email/password form, and the POST /api/auth/login call live here once (DRY
// guard rail — see docs/patterns/dry-guard-rail.md). Pages supply the title, button labels,
// and the on-success behavior (redirect vs. agent callback).

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';

/** Centered card shell used by both auth pages. */
export function AuthCardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

// FR-2 (feature 122): email format + required, password required — reproduces the native
// type="email"/required checks with equivalent messages, not new stricter copy.
const credentialsSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type CredentialsValues = z.infer<typeof credentialsSchema>;

/** Email/password form that authenticates against /api/auth/login and calls onSuccess. */
export function CredentialsForm({
  submitLabel,
  loadingLabel,
  onSuccess,
}: {
  submitLabel: string;
  loadingLabel: string;
  onSuccess: () => void;
}) {
  // Submit-level network/server error — not zod-expressible, kept as local state.
  const [error, setError] = useState('');
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CredentialsValues>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: CredentialsValues) {
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Login failed. Please check your credentials.');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Field>
            <Input type="email" placeholder="Email" required disabled={isSubmitting} {...field} />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Field>
            <Input
              type="password"
              placeholder="Password"
              required
              disabled={isSubmitting}
              {...field}
            />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? loadingLabel : submitLabel}
      </Button>
    </form>
  );
}
