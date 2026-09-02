import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@toolgraph/ui';

/** Shared chrome for the signed-out pages. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border-subtle px-4 py-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <Image src="/toolgraph.png" alt="" width={24} height={24} className="rounded" priority />
          <span className="truncate text-sm font-semibold tracking-tight">Toolgraph</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">{children}</main>

      <footer className="border-t border-border-subtle px-4 py-4 text-center text-xs text-fg-subtle sm:px-6">
        Type-checked MCP tool graphs, exported as code you own.
      </footer>
    </div>
  );
}
