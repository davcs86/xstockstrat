import { Card, CardContent } from '../ui/card';
import { AlertDescription } from '../ui/alert';

/** A single-line message wrapped in a Card — used for portfolio loading/unavailable states. */
export function CardNotice({
  children,
  variant = 'muted',
}: {
  children: React.ReactNode;
  variant?: 'muted' | 'error';
}) {
  return (
    <Card role={variant === 'error' ? 'alert' : undefined}>
      <CardContent className="pt-5">
        <AlertDescription
          className={variant === 'error' ? 'text-destructive' : 'text-muted-foreground'}
        >
          {children}
        </AlertDescription>
      </CardContent>
    </Card>
  );
}
