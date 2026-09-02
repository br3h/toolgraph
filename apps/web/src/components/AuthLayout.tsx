import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@toolgraph/ui';

/** Shared chrome for the signed-out pages. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/toolgraph.png" alt="" width={24} height={24} className="rounded" priority />
          <span className="text-sm font-semibold tracking-tight">Toolgraph</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">{children}</main>

      <footer className="border-t border-border-subtle px-6 py-4 text-center text-xs text-fg-subtle">
        Type-checked MCP tool graphs, exported as code you own.
      </footer>
    </div>
  );
}
