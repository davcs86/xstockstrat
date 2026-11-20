import { z } from 'zod';

// Validation reproduces the native type=email/required checks with equivalent messages, not stricter copy.
// html5Email (not zod's default) so dotless hosts like admin@localhost are accepted, as type=email does.
export const credentialsSchema = z.object({
  email: z.email({ pattern: z.regexes.html5Email, error: 'Enter a valid email address' }),
  password: z.string().min(1, 'Password is required'),
  // Extended-session opt-in: sent in the login POST body; the login route persists cookies (Max-Age) only when true.
  rememberMe: z.boolean(),
});

export type CredentialsValues = z.infer<typeof credentialsSchema>;
