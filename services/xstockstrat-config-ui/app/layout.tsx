import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'xstockstrat Config UI',
  description: 'Runtime configuration management for the xstockstrat platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
          <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
            {/* Logo */}
            <a href="http://localhost:3002" className="flex items-center gap-2 text-primary font-semibold shrink-0">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span className="hidden sm:inline text-sm">xstockstrat Config</span>
            </a>

            <div className="hidden sm:block h-6 w-px bg-border" />

            {/* Platform nav */}
            <nav className="hidden sm:flex items-center gap-1">
              <a href="http://localhost:3000" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                Trader
              </a>
              <a href="http://localhost:3001" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                Insights
              </a>
              <a href="http://localhost:3002" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-accent text-foreground font-medium transition-colors">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" /></svg>
                Config
              </a>
            </nav>

            <div className="hidden sm:block h-6 w-px bg-border mx-1" />

            {/* In-app nav */}
            <nav className="hidden sm:flex items-center gap-1">
              <Link href="/" className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                Namespaces
              </Link>
              <Link href="/audit" className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
                Audit Log
              </Link>
            </nav>
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </body>
    </html>
  );
}
