import { useQuery } from '@tanstack/react-query';
import { BASE_PATH_CONFIG_UI } from '@/lib/basepath';

interface AuditEntry {
  id: string;
  namespace: string;
  key: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  reason: string;
  changedAt: string;
  environment: string;
  userId: string;
}

async function fetchAuditLog(): Promise<AuditEntry[]> {
  const res = await fetch(`${BASE_PATH_CONFIG_UI}/api/audit`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new Error((body as { error?: string }).error ?? `Audit fetch failed (${res.status})`);
  }
  const data: { entries?: AuditEntry[] } = await res.json();
  return data.entries ?? [];
}

export function useAuditLog(): {
  data: AuditEntry[] | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['audit-log'],
    queryFn: fetchAuditLog,
  });
}
