# Contributing to toolgraph

Thanks for wanting to help. This document covers everything you need to get a
change merged.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Getting set up

```bash
nvm use                      # Node 22.22.2, pinned in .nvmrc
pnpm install                 # also installs the git hooks via husky
cp .env.example .env.local   # fill in your own free-tier keys
pnpm dev
```

You do **not** need every service to develop. Only the three Supabase variables
are required to boot. Sentry and PostHog no-op when unset, and rate limiting
falls back to an in-memory limiter when Upstash is not configured.

`gitleaks` is required — the pre-commit hook **fails closed** without it:

```bash
brew install gitleaks        # macOS
# or see https://github.com/gitleaks/gitleaks#installing
```

---

## Branch naming

Branch off `main`:

```
<type>/<short-kebab-description>
```

| Type        | Use it for                                |
| ----------- | ----------------------------------------- |
| `feat/`     | A new capability                          |
| `fix/`      | A bug fix                                 |
| `docs/`     | Documentation only                        |
| `refactor/` | Behaviour-preserving restructuring        |
| `test/`     | Adding or fixing tests                    |
| `chore/`    | Tooling, dependencies, CI                 |
| `security/` | Hardening, or a fix for a disclosed issue |

Examples: `feat/nested-array-type-check`, `fix/sse-cold-start-retry`,
`security/tighten-ssrf-ipv6-mapping`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(schema-core): support anyOf branches in output compatibility
fix(engine): re-check resolved IPs on redirect, not just initial connect
docs(readme): document the Namecheap ALIAS record for the apex
```

The `commit-msg` hook scans the message itself for secret-shaped strings.

---

## Running tests locally

```bash
pnpm lint          # ESLint, zero warnings tolerated
pnpm typecheck     # tsc --noEmit everywhere; TypeScript is strict, no `any`
pnpm test          # Vitest unit + integration
pnpm test:e2e      # Playwright smoke test — needs both apps running
pnpm test:rls      # RLS isolation — needs `supabase start` (Docker)
```

Run all of these before you open a PR. CI runs exactly the same commands with
**no live secrets present**, so if your change needs a real key to pass, it will
fail CI. Mock the boundary instead.

Targeting one package:

```bash
pnpm --filter @toolgraph/schema-core test
pnpm --filter @toolgraph/engine typecheck
```

---

## Code style

Formatting and linting are automated; do not hand-format.

```bash
pnpm format        # Prettier over everything
pnpm lint:fix      # ESLint autofix
```

Rules the linter enforces, and reviewers will too:

- **TypeScript is strict everywhere.** `noUncheckedIndexedAccess` is on. Do not
  reach for `any` — `@typescript-eslint/no-explicit-any` is an error, not a
  warning. If you genuinely need an escape hatch, use `unknown` and narrow it.
- **No dynamic execution.** `eval`, `new Function`, and `javascript:` URLs are
  banned outright. Nothing an MCP server returns is ever executed beyond what
  the protocol itself defines.
- **Type-only imports use `import type`.**
- Prefer reusing a component over duplicating one.

---

## Things a reviewer will always check

**Every API route and engine endpoint validates its input with a `zod` schema**
before touching it, and rejects with `400` on failure. There are no exceptions
to this.

**Every new Supabase table gets explicit RLS policies** scoped to the owning
user, written in the same migration that creates the table. Add a case to the
RLS test as well.

**Secrets stay server-side.** `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`,
`SENTRY_AUTH_TOKEN` and `UPSTASH_REDIS_REST_TOKEN` must never be imported into a
client component or anything that reaches a browser bundle. CI greps the built
output for their values and fails on a match.

**New UI is monochrome.** No hue anywhere. The single documented exception is
the dashed stroke on an invalid canvas edge — see the design system section of
the README. Use the tokens in `packages/ui/src/styles.css`; do not introduce a
raw hex value in a component.

**Exported code stays dependency-light.** The whole point of the export feature
is that the generated TypeScript and Python have zero toolgraph runtime
dependency. A change that makes generated code import from toolgraph will be
rejected.

**New behaviour has a test.** For `schema-core` in particular, add cases for the
mismatch you are handling _and_ the near-miss that should still pass.

---

## Pull request process

1. Open an issue first for anything non-trivial, so the approach can be agreed
   before you write it.
2. Branch from `main`, make your change, add tests.
3. Run the full local suite above.
4. Open the PR and fill in the template. Explain _why_, not just _what_.
5. CI must be green: lint, typecheck, unit tests, RLS tests, e2e smoke, build,
   and `pnpm audit` with no unfixed high or critical advisory.
6. One maintainer approval merges it. We squash-merge, so your PR title becomes
   the commit message — make it a good Conventional Commit line.

Keep PRs small. A 200-line PR gets reviewed today; a 2,000-line one waits.

---

## Reporting security issues

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).
