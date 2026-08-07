import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Factory for the recurring "call a BFF RPC, then invalidate some query keys" mutation
 * hook. It replaces the near-identical `useMutation` + `useQueryClient` + `onSuccess →
 * invalidateQueries` boilerplate that was copy-pasted across the order and watchlist hooks.
 * See docs/patterns/dry-guard-rail.md.
 *
 * @param mutationFn      the RPC call.
 * @param invalidateKeys  query keys to invalidate on success — either a static list or a
 *                        function of the input/result (e.g. to invalidate a per-id query).
 * @param options.mutationKey  optional TanStack Query mutation key, so an ancestor component that
 *                              never remounts can detect an in-flight write via `useIsMutating`
 *                              even after the component that started it has unmounted (feature 110
 *                              design.md §5 Layer 2 — the cross-instance concurrency guard).
 */
export function useInvalidatingMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  invalidateKeys: QueryKey[] | ((input: TInput, result: TResult) => QueryKey[]),
  options?: { mutationKey?: QueryKey },
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn,
    mutationKey: options?.mutationKey,
    onSuccess: (result, input) => {
      const keys =
        typeof invalidateKeys === 'function' ? invalidateKeys(input, result) : invalidateKeys;
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
