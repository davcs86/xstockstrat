// Only allow redirects back into one of the known basePaths (open-redirect guard).
export function safeRedirect(target: string | null): string {
  if (
    target &&
    (target.startsWith('/trader') ||
      target.startsWith('/insights') ||
      target.startsWith('/config-ui'))
  ) {
    return target;
  }
  return '/trader';
}
