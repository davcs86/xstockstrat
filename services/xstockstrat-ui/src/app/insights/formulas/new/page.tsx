'use client';
import { useRouter } from 'next/navigation';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/insights/AppShell';
import { FormulaWorkspace } from '@/components/insights/FormulaWorkspace';
import { useRegisterFormula } from '@/hooks/useFormulas';

export default function NewFormulaPage() {
  const router = useRouter();
  const { mutate, isPending, error: errorObj } = useRegisterFormula();

  const error =
    errorObj instanceof ConnectError ? errorObj.rawMessage : (errorObj?.message ?? null);

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <FormulaWorkspace
          mode="create"
          saving={isPending}
          saveError={error}
          onSave={(values) =>
            mutate(values, {
              onSuccess: (data) => router.push(`/insights/formulas/${data.formulaId}`),
            })
          }
          onCancel={() => router.push('/insights/formulas')}
        />
      </div>
    </AppShell>
  );
}
