import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/public-env';
import { DemoAnimation } from '@/components/DemoAnimation';
import { MarketingShell, REPO } from '@/components/marketing/MarketingShell';

export const metadata: Metadata = {
  /*
   * NOTE: no `title` here, deliberately.
   *
   * The homepage's browser tab must read exactly "Toolgraph" — the wordmark and
   * nothing else — and the root layout already sets that as a plain string with
   * no template. Adding a title here, even the same string, is one more place
   * for it to drift.
   */
  description:
    "Toolgraph is a typed integration layer for MCP servers and APIs. Wire tools together on a canvas; every connection is checked against the tools' real JSON Schemas before it runs, and exports to TypeScript or Python you own outright.",
  alternates: { canonical: '/' },
};

export const dynamic = 'force-dynamic';

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle pt-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{children}</p>
    </div>
  );
}

/**
 * Structured data.
 *
 * Two types, and both are true: Toolgraph is a SoftwareApplication with a free
 * tier, and the page answers a set of questions. The FAQ entries below are the
 * same questions and the same answers rendered on the page — a mismatch between
 * markup and visible content is what search engines treat as spam, and rightly.
 */
function structuredData(siteUrl: string) {
  const base = siteUrl.replace(/\/$/, '');

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${base}/#app`,
        name: 'Toolgraph',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        url: base,
        description:
          "A typed integration layer for MCP servers and APIs. Connections are checked against the tools' real JSON Schemas at design time, then exported as standalone TypeScript or Python.",
        license: 'https://opensource.org/licenses/MIT',
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Pro', price: '15', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Team', price: '12', priceCurrency: 'USD' },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${base}/#faq`,
        mainEntity: [
          {
            '@type': 'Question',
            name: 'What is the Model Context Protocol?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'An open protocol for exposing tools to language models. A server advertises its tools, each with a JSON Schema describing what it takes and returns. Those schemas are machine-readable contracts, which is what lets Toolgraph check two tools against each other before either one runs.',
            },
          },
          {
            '@type': 'Question',
            name: 'What does Toolgraph check?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'Primitive types, object shapes, required and optional properties, arrays and tuples, enum and const as a subset test, anyOf and oneOf branches, $ref resolution, and numeric and string constraints. An incompatible connection names the field, the expected type and the actual type.',
            },
          },
          {
            '@type': 'Question',
            name: 'Am I locked in?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: 'No. A valid graph exports to standalone TypeScript with zod validators or Python with Pydantic models, and the generated code has zero Toolgraph runtime dependency. Toolgraph itself is MIT licensed and self-hostable.',
            },
          },
        ],
      },
    ],
  };
}

export default async function LandingPage() {
  // Someone already signed in wants the product, not the pitch.
  if (await getCurrentUser()) redirect('/graphs');

  return (
    <MarketingShell>
      {/*
        JSON-LD, rendered as a script tag. It carries no nonce and does not need
        one: the CSP's script-src covers executable script, and
        `application/ld+json` is data the browser never executes.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(publicEnv.siteUrl)) }}
      />

      <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
          Model Context Protocol
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
          Wire MCP tools together, and find out it works before you run it.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
          One tool returns <code className="font-mono text-fg">{'{ user: { id: number } }'}</code>.
          The next one wants <code className="font-mono text-fg">{'{ userId: string }'}</code>.
          Nothing tells you until it breaks in production. Toolgraph checks every connection against
          the tools&apos; real JSON Schemas the moment you draw it.
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
        <h2 className="sr-only">Why Toolgraph</h2>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Feature title="Checked at design time">
            Every connection is validated against both tools&apos; real schemas before the edge
            exists. Incompatible ones are refused with the field, the expected type and the actual
            type — not a generic error.
          </Feature>

          <Feature title="Connections you keep">
            Save a server once and use it from any graph. Its authorization header is encrypted
            under a key that is not in the database, and a workspace can share a connection without
            members ever seeing the credential.
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
                body: 'Point Toolgraph at an MCP server over streamable HTTP or SSE. It reads the tools and their schemas directly from the protocol, and remembers the connection for every graph you build.',
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

      {/* The visible half of the FAQ structured data above. They must match. */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="text-xl font-semibold tracking-tight">Questions people actually ask</h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-3">
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">
              What is the Model Context Protocol?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              An open protocol for exposing tools to language models. A server advertises its tools,
              each with a JSON Schema describing what it takes and returns. Those schemas are
              machine-readable contracts, which is what lets Toolgraph check two tools against each
              other before either one runs.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">What does Toolgraph check?</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Primitive types, object shapes, required and optional properties, arrays and tuples,
              enum and const as a subset test, anyOf and oneOf branches, $ref resolution, and
              numeric and string constraints. An incompatible connection names the field, the
              expected type and the actual type.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">Am I locked in?</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              No. A valid graph exports to standalone TypeScript with zod validators or Python with
              Pydantic models, and the generated code has zero Toolgraph runtime dependency.
              Toolgraph itself is MIT licensed and self-hostable.{' '}
              <Link href="/docs" className="text-fg underline underline-offset-2">
                Read the docs
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
