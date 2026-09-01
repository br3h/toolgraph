# Security policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, the impact, and the steps to reproduce it.

If private reporting is unavailable to you, email the maintainer listed on the
GitHub profile that owns this repository instead.

## What to expect

| Stage              | Target                                     |
| ------------------ | ------------------------------------------ |
| Acknowledgement    | within 3 business days                     |
| Initial assessment | within 10 business days                    |
| Fix or mitigation  | depends on severity; critical issues first |

We will keep you updated while we work, and we will credit you in the release
notes unless you ask us not to.

## No bug bounty

This project has **no bug bounty programme** and offers no monetary reward for
reports. It is a volunteer-maintained open-source project. We are still very
grateful for responsible disclosure.

## Scope

In scope:

- `apps/web` — the Next.js application and its API routes
- `apps/engine` — the execution engine, especially its SSRF guard
- `packages/*` — the shared schema, codegen and MCP client libraries
- The Supabase Row Level Security policies in `supabase/migrations/`

Out of scope:

- Vulnerabilities in third-party MCP servers a user chooses to connect to
- Denial of service against a self-hosted deployment you control
- Findings that require a compromised developer machine or a leaked credential
  that the reporter supplied themselves
- Missing hardening headers on preview deployments

## Security model, in brief

- The execution engine accepts **user-supplied MCP server URLs**. Every outbound
  connection passes an SSRF guard that blocks loopback, RFC1918, link-local,
  carrier-grade NAT, unique-local IPv6, and cloud metadata addresses. DNS is
  resolved and every resolved IP is re-checked before connect, so DNS rebinding
  does not bypass the hostname check.
- Per-server credentials are **never persisted in plaintext**. They are supplied
  at connect time and passed through, or stored in Supabase Vault.
- Every table has explicit Row Level Security scoped to the owning user, and a
  CI test asserts one user cannot read another user's rows.
- No secret is ever read outside server-side code. A build-time check greps the
  compiled output for secret values and fails on any match.
