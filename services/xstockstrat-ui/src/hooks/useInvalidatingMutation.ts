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
 */
export function useInvalidatingMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  invalidateKeys: QueryKey[] | ((input: TInput, result: TResult) => QueryKey[]),
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn,
    onSuccess: (result, input) => {
      const keys =
        typeof invalidateKeys === 'function' ? invalidateKeys(input, result) : invalidateKeys;
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
