'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FormulaEditor } from '@/components/insights/FormulaEditor';
import { useRegisterFormula } from '@/hooks/useFormulas';

export default function NewFormulaPage() {
  const router = useRouter();
  const { mutate, isPending, error: errorObj } = useRegisterFormula();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('# return a numeric result\nresult = 0\n');
  const [isPublic, setIsPublic] = useState(false);

  const error =
    errorObj instanceof ConnectError
      ? errorObj.rawMessage
      : (errorObj?.message ?? null);

  function handleSubmit() {
    mutate(
      { name, description, source, isPublic },
      {
        onSuccess: (data) => router.push(`/insights/formulas/${data.formulaId}`),
      },
    );
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">New Formula</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Formula definition</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My RSI variant" name="name" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Description</label>
                <textarea
                  className="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Source (Python)</label>
                <FormulaEditor value={source} onChange={setSource} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                Public (visible to all users)
              </label>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <div className="flex gap-2">
                <Button onClick={handleSubmit} disabled={isPending || !name}>
                  {isPending ? 'Saving…' : 'Create Formula'}
                </Button>
                <Button variant="ghost" onClick={() => router.push('/insights/formulas')}>
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
