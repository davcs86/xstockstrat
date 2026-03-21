'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart2, TrendingUp, Settings, Menu, Activity } from 'lucide-react';
import { cn } from './ui/utils';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Separator } from './ui/separator';

interface InsightsNavItem {
  label: string;
  href: string;
  external?: boolean;
}

const PLATFORM_NAV = [
  { label: 'Trader', href: 'http://localhost:3000', icon: <TrendingUp className="h-4 w-4" /> },
  { label: 'Insights', href: 'http://localhost:3001', icon: <BarChart2 className="h-4 w-4" /> },
  { label: 'Config', href: 'http://localhost:3002', icon: <Settings className="h-4 w-4" /> },
];

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
}

export function AppShell({ children, title = 'xstockstrat Insights', actions }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 text-primary font-semibold shrink-0">
            <Activity className="h-5 w-5" />
            <span className="hidden sm:inline text-sm">{title}</span>
          </Link>

          <Separator orientation="vertical" className="h-6 hidden sm:block" />

          {/* Desktop nav — platform links */}
          <nav className="hidden sm:flex items-center gap-1 flex-1">
            {PLATFORM_NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                  item.label === 'Insights'
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )}
              >
                {item.icon}
                {item.label}
              </a>
            ))}

            <Separator orientation="vertical" className="h-5 mx-1" />

            {/* In-app nav */}
            <Link
              href="/"
              className={cn(
                'px-3 py-1.5 rounded-md text-sm transition-colors',
                pathname === '/'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              Dashboard
            </Link>
            <Link
              href="/strategies"
              className={cn(
                'px-3 py-1.5 rounded-md text-sm transition-colors',
                pathname?.startsWith('/strategies')
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              Strategies
            </Link>
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto">
            {actions}
            {/* Mobile nav trigger */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-primary">
                    <Activity className="h-5 w-5" />
                    xstockstrat
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1">
                  {PLATFORM_NAV.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                        item.label === 'Insights'
                          ? 'bg-accent text-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </a>
                  ))}
                  <Separator className="my-2" />
                  <Link href="/" className={cn('px-3 py-2.5 rounded-md text-sm transition-colors', pathname === '/' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}>
                    Dashboard
                  </Link>
                  <Link href="/strategies" className={cn('px-3 py-2.5 rounded-md text-sm transition-colors', pathname?.startsWith('/strategies') ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}>
                    Strategies
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
