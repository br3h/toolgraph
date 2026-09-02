import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketingShell, REPO } from '@/components/marketing/MarketingShell';
import { Prose } from '@/components/marketing/Prose';
import { getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Docs | Toolgraph',
  description:
    'How Toolgraph works: connecting MCP servers, what design-time type checking actually checks, running a graph, and exporting it as TypeScript or Python you own.',
  alternates: { canonical: '/docs' },
  openGraph: {
    title: 'Docs | Toolgraph',
    description:
      'Connecting MCP servers, design-time type checking, running graphs, and exporting code.',
    type: 'article',
  },
};

export default async function DocsPage() {
  const signedIn = Boolean(await getCurrentUser());

  return (
    <MarketingShell signedIn={signedIn}>
      <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">
          Documentation
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          How Toolgraph works
        </h1>

        <Prose>
          <h2>What the Model Context Protocol is</h2>
          <p>
            MCP is an open protocol for exposing tools to language models. A server advertises a
            list of tools, and each tool comes with a JSON Schema describing exactly what it takes
            and — when the server bothers — what it returns. Those schemas are the whole reason
            Toolgraph exists: they are machine-readable contracts published by the tool itself, so
            two tools can be checked against each other without anyone writing an integration first.
          </p>
          <p>
            You do not need to know anything else about the protocol to use Toolgraph. If you have a
            URL for an MCP server, that is enough.
          </p>

          <h2>Connections</h2>
          <p>
            A connection is a server you have told Toolgraph about, saved once and usable from every
            graph. Three transports are supported: streamable HTTP and server-sent events, which a
            hosted engine can reach, and <code>stdio</code>, which spawns a local process and is
            therefore refused by the hosted engine and available only when you run the engine
            yourself.
          </p>
          <p>
            Testing a connection reads the server&apos;s tools and their schemas and caches them, so
            opening a graph does not have to wake the engine to draw a palette. The cache is never
            trusted for execution — every run re-reads the server for real.
          </p>

          <h3>Credentials</h3>
          <p>
            If a server needs an <code>Authorization</code> header, you can save it with the
            connection. It is encrypted with AES-256-GCM before it reaches the database, under a key
            held in the server environment rather than in Postgres, and the table it lives in is
            granted to the server role alone — no browser session can read it by any query. It is
            decrypted only to make an outbound request to the server you pointed it at, and it is
            never returned to a browser, written to a log, or included in an export.
          </p>
          <p>
            On a deployment with no encryption key configured, Toolgraph refuses to store
            credentials at all rather than storing them in some weaker form. You type the header
            when you test the connection and it is dropped afterwards.
          </p>

          <h2>Type checking, at design time</h2>
          <p>
            This is the part that is different. When you draw an edge from one tool&apos;s output
            field to another tool&apos;s input field, Toolgraph resolves both sides to a concrete
            JSON Schema and checks whether the source can satisfy the target — before the edge
            exists, not when the graph runs.
          </p>
          <p>What that check covers:</p>
          <ul>
            <li>Primitive types, including the integer-versus-number distinction.</li>
            <li>Object shapes, required versus optional properties, and additional properties.</li>
            <li>Arrays and tuples, element by element.</li>
            <li>
              <code>enum</code> and <code>const</code>, as a subset test — a source that may produce
              a value the target does not accept is refused.
            </li>
            <li>
              <code>anyOf</code> and <code>oneOf</code>, by finding a branch that satisfies the
              target, and refusing when none does.
            </li>
            <li>
              <code>$ref</code>, resolved within the document, with a depth limit so a recursive
              schema cannot hang the checker.
            </li>
            <li>Numeric and string constraints, where the target&apos;s cannot be guaranteed.</li>
          </ul>
          <p>
            An incompatible connection is not merely rejected. You are told the field, the type the
            target needs and the type the source supplies, in a sentence — because &ldquo;invalid
            connection&rdquo; tells you nothing you can act on.
          </p>
          <p>
            A tool whose server declares no output schema is handled honestly: nothing can be proven
            about it, so its outgoing connections are warnings rather than errors, and they say so.
          </p>

          <h2>Running a graph</h2>
          <p>
            A test-run sends the graph and any per-call credentials to the execution engine in one
            request, and results stream back over server-sent events on that same request. Each step
            appears as it finishes.
          </p>
          <p>
            The engine is a separate service because a serverless function cannot hold a
            multi-minute streaming session or a stdio subprocess. It is stateless: nothing is kept
            between requests, so it can sleep and wake without losing anything. It does sleep — it
            runs on a free plan — and the first request after a quiet period takes about a minute.
            The UI says so rather than looking broken.
          </p>
          <p>
            Per-step inputs and outputs are streamed to your browser and are never written down.
            What is stored is the summary: that a run happened, how long it took, how many steps,
            and where it stopped. You can see those under Runs.
          </p>

          <h2>Exporting</h2>
          <p>
            A valid graph exports to standalone TypeScript — real interfaces generated from the
            schemas, plus <code>zod</code> validators — or Python, with Pydantic models and typed
            functions. The generated code has zero Toolgraph runtime dependency. You can delete your
            account and it keeps working.
          </p>
          <p>
            Exports never contain credentials. What they contain is an <code>.env.example</code>{' '}
            naming what the code will need.
          </p>

          <h2>Workspaces</h2>
          <p>
            A workspace is a shared container. Graphs and connections in one are visible to every
            member, and a shared connection stores its credential once — members use it without ever
            seeing it. Roles are owner, admin and member: admins invite and remove people, the owner
            can additionally transfer or delete the workspace.
          </p>
          <p>
            An invitation is addressed to an email address and has no token in the link, on purpose.
            Accepting requires being signed in as that address, so forwarding the mail does not pass
            the invitation on.
          </p>

          <h2>Self-hosting</h2>
          <p>
            Toolgraph is MIT licensed and the whole stack is in the repository: the Next.js app, the
            Fastify engine, the shared packages and every database migration. The{' '}
            <a href={REPO} target="_blank" rel="noreferrer noopener">
              README
            </a>{' '}
            covers running it locally and deploying it, and <code>.env.example</code> documents
            every variable, where to get it, and whether it is a secret.
          </p>
        </Prose>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link
            href={signedIn ? '/graphs' : '/signup'}
            className="rounded-[var(--tg-radius-md)] bg-accent px-5 py-2.5 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
          >
            {signedIn ? 'Open your graphs' : 'Start building'}
          </Link>
          <Link
            href="/pricing"
            className="rounded-[var(--tg-radius-md)] border border-border px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
          >
            See pricing
          </Link>
        </div>
      </div>
    </MarketingShell>
  );
}
