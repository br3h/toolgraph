import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-fg-subtle">404</p>
        <h1 className="mt-3 text-lg font-semibold tracking-tight">There is nothing here</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          That page does not exist, or the graph it pointed at is not one of yours.
        </p>
        <Link
          href="/graphs"
          className="mt-6 inline-block rounded-[var(--tg-radius-md)] bg-accent px-5 py-2.5 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
        >
          Back to your graphs
        </Link>
      </div>
    </div>
  );
}
