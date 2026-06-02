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
  tradingMode: string;
}

async function fetchAuditLog(): Promise<AuditEntry[]> {
  const res = await fetch(`${BASE_PATH_CONFIG_UI}/api/audit`);
  const data: { entries?: AuditEntry[] } = await res.json();
  return data.entries ?? [];
}

export function useAuditLog(): { data: AuditEntry[] | undefined; isLoading: boolean } {
  return useQuery({
    queryKey: ['audit-log'],
    queryFn: fetchAuditLog,
  });
}
