import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ThemeToggle } from '@toolgraph/ui';

import { getCurrentUser } from '@/lib/supabase/server';
import { DemoAnimation } from '@/components/DemoAnimation';

export const metadata: Metadata = {
  description:
    "Wire MCP tools together on a canvas. Every connection is checked against the tools' real JSON Schemas before it runs, and exports to TypeScript or Python you own outright.",
};

export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/br3h/toolgraph';

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle pt-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{children}</p>
    </div>
  );
}

export default async function LandingPage() {
  // Someone already signed in wants the product, not the pitch.
  if (await getCurrentUser()) redirect('/graphs');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/toolgraph.png"
              alt=""
              width={22}
              height={22}
              className="rounded"
              priority
            />
            <span className="text-sm font-semibold tracking-tight">Toolgraph</span>
          </Link>

          <nav className="flex items-center gap-1.5">
            <Link
              href="/pricing"
              className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Pricing
            </Link>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              GitHub
            </a>
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-[var(--tg-radius-sm)] bg-accent px-3 py-1.5 text-xs font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
            Model Context Protocol
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
            Wire MCP tools together, and find out it works before you run it.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
            One tool returns <code className="font-mono text-fg">{'{ user: { id: number } }'}</code>
            . The next one wants <code className="font-mono text-fg">{'{ userId: string }'}</code>.
            Nothing tells you until it breaks in production. Toolgraph checks every connection
            against the tools&apos; real JSON Schemas the moment you draw it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="rounded-[var(--tg-radius-md)] bg-accent px-5 py-2.5 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
            >
              Start building
            </Link>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[var(--tg-radius-md)] border border-border px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
            >
              Read the source
            </a>
          </div>

          <div className="mt-14">
            <DemoAnimation caption="Drawn live in the browser. The mismatch is refused as the connection is made." />
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-20">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Feature title="Checked at design time">
              Every connection is validated against both tools&apos; real schemas before the edge
              exists. Incompatible ones are refused with the field, the expected type and the actual
              type — not a generic error.
            </Feature>

            <Feature title="Run it for real">
              Test the whole graph against the live servers and watch each step stream back as it
              finishes. No mock layer between you and what will actually happen.
            </Feature>

            <Feature title="Export code you own">
              Generate standalone TypeScript with real interfaces and zod validators, or Python with
              Pydantic models. Zero Toolgraph dependency — delete your account and the code keeps
              working.
            </Feature>

            <Feature title="MIT licensed">
              The whole thing is open source and self-hostable. Nothing here is a proprietary
              runtime you would have to migrate off later.
            </Feature>
          </div>
        </section>

        <section className="border-t border-border-subtle bg-bg-subtle">
          <div className="mx-auto w-full max-w-5xl px-6 py-16">
            <h2 className="text-xl font-semibold tracking-tight">How it fits together</h2>
            <ol className="mt-6 grid gap-6 sm:grid-cols-3">
              {[
                {
                  step: 'One',
                  title: 'Connect a server',
                  body: 'Point Toolgraph at an MCP server over streamable HTTP or SSE. It reads the tools and their schemas directly from the protocol.',
                },
                {
                  step: 'Two',
                  title: 'Draw the graph',
                  body: 'Drop tools on the canvas and connect field to field. Anything that would not type-check is refused, with the mismatch named inline.',
                },
                {
                  step: 'Three',
                  title: 'Run it, then take it',
                  body: 'Test against the real servers, then export the graph as TypeScript or Python and run it wherever you like.',
                },
              ].map((item) => (
                <li key={item.step}>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
                    {item.step}
                  </p>
                  <h3 className="mt-2 text-sm font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-fg-subtle">
            Toolgraph — type-checked MCP tool graphs. MIT licensed.
          </p>
          <nav className="flex flex-wrap items-center gap-4 text-xs">
            <Link href="/pricing" className="text-fg-muted transition-colors hover:text-fg">
              Pricing
            </Link>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Source
            </a>
            <a
              href={`${REPO}/blob/main/SECURITY.md`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Security
            </a>
            <a
              href={`${REPO}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Licence
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
