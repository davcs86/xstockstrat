import { Card, CardContent } from '../ui/card';

/** A single-line message wrapped in a Card — used for portfolio loading/unavailable states. */
export function CardNotice({
  children,
  variant = 'muted',
}: {
  children: React.ReactNode;
  variant?: 'muted' | 'error';
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p
          className={`text-sm ${variant === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {children}
        </p>
      </CardContent>
    </Card>
  );
}
