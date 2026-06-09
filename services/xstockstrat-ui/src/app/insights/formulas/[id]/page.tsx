'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/insights/AppShell';
import { FormulaWorkspace } from '@/components/insights/FormulaWorkspace';
import { useFormula, useUpdateFormula, useDeleteFormula } from '@/hooks/useFormulas';

export default function FormulaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: formula, isLoading } = useFormula(id);
  const updateMut = useUpdateFormula();
  const deleteMut = useDeleteFormula();

  const updateError =
    updateMut.error instanceof ConnectError
      ? updateMut.error.rawMessage
      : (updateMut.error?.message ?? null);

  function handleDelete() {
    if (!window.confirm('Delete this formula? This cannot be undone.')) return;
    deleteMut.mutate(
      { formulaId: id, userId: '' },
      { onSuccess: () => router.push('/insights/formulas') },
    );
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">Loading formula…</p>
        </div>
      </AppShell>
    );
  }

  if (!formula) {
    return (
      <AppShell>
        <div className="p-4 sm:p-6">
          <p className="text-sm text-destructive">Formula not found.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <FormulaWorkspace
          // Re-mount (reset local edits) when navigating between formulas.
          key={formula.formulaId}
          mode="edit"
          initialName={formula.name}
          initialDescription={formula.description}
          initialSource={formula.source}
          initialIsPublic={formula.isPublic}
          initialParameters={formula.parameters}
          initialOutputs={formula.outputs}
          author={formula.author}
          saving={updateMut.isPending}
          saveError={updateError}
          onSave={(values) => updateMut.mutate({ formulaId: id, ...values })}
          onCancel={() => router.push('/insights/formulas')}
          onDelete={handleDelete}
          deleting={deleteMut.isPending}
        />
      </div>
    </AppShell>
  );
}
