## What this changes

<!-- One or two sentences. Link the issue it closes, if there is one. -->

Closes #

## How to verify

<!-- The exact commands or clicks a reviewer should run. -->

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] New behaviour has a test
- [ ] No secret, token, or `.env.local` value appears anywhere in the diff
- [ ] Any new API route or engine endpoint validates its input with a `zod` schema
- [ ] Any new UI is strictly monochrome (no hue outside the documented canvas-edge exception)
- [ ] Any new Supabase table has explicit RLS policies scoped to the owning user
- [ ] `.env.example` updated if a new environment variable was introduced
