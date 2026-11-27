import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

// A native POST: /api/auth/sso/start checks the Origin header, so a Referrer-Policy of
// no-referrer on this page would break it (D-54).
export function SsoSignInForm({ redirect }: { redirect: string }) {
  return (
    <form method="post" action="/api/auth/sso/start" className="space-y-4">
      <input type="hidden" name="redirect" value={redirect} />
      <div className="flex items-center gap-2">
        <Checkbox id="ssoRememberMe" name="remember" value="1" />
        <Label htmlFor="ssoRememberMe" className="text-sm font-normal">
          Keep me signed in for 14 days (SSO)
        </Label>
      </div>
      <Button type="submit" className="w-full">
        Sign in with SSO
      </Button>
    </form>
  );
}
