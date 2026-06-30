/** Inline loading / error messages for a data panel. Single source of truth (DRY guard rail). */
export function QueryStateMessages({
  isLoading,
  error,
  loadingText = 'Loading…',
  errorText,
}: {
  isLoading?: boolean;
  error?: unknown;
  loadingText?: string;
  errorText: string;
}) {
  return (
    <>
      {isLoading && <p className="text-sm text-muted-foreground">{loadingText}</p>}
      {error ? <p className="text-sm text-destructive">{errorText}</p> : null}
    </>
  );
}
