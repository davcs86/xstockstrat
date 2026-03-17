import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'xstockstrat Config UI',
  description: 'Runtime configuration management for the xstockstrat platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen font-mono">
        <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-green-400">xstockstrat / config-ui</span>
        </header>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
