type MutationErrorSlot = { message: string } | null;

let current: MutationErrorSlot = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function reportMutationError(message: string): void {
  current = { message };
  emit();
}

export function clearMutationError(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getMutationError(): MutationErrorSlot {
  return current;
}

export function getServerMutationError(): MutationErrorSlot {
  return null;
}

export function subscribeMutationError(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// `meta.errorHandled === true` is the only opt-out; a per-call `onError` is invisible to the MutationCache.
export function shouldReportMutationError(meta: Record<string, unknown> | undefined): boolean {
  return meta?.errorHandled !== true;
}
