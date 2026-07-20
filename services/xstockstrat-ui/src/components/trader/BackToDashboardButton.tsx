import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/button';

/** "Back to dashboard" link button shared by the trader sub-pages (DRY guard rail). */
export function BackToDashboardButton() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href="/trader" className="flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>
    </Button>
  );
}
