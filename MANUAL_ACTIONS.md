# Manual actions required

_Last updated for commit `80fc03c` (the connections / workspaces / billing pass)._

Everything in this file needs you, because it needs a dashboard login or a value
that must never live in the repository. Toolgraph runs without any of it — each
item makes one specific thing work that is currently, and honestly, marked as
not configured.

Nothing here is urgent enough to block the release. They are ordered by what you
get for the effort.

---

## 1. Turn on stored connection credentials

**What it fixes.** Today, saving a connection with an `Authorization` header
shows "Credentials are not stored on this deployment" and the header has to be
typed each time you test. With this set, it is encrypted and remembered, and a
workspace can share a connection without members ever seeing the token behind it.

**This is the highest-value item on the list**, and it takes about two minutes.

1. On your own machine, open a terminal and run:

   ```
   openssl rand -base64 32
   ```

   It prints one line, roughly 44 characters ending in `=`. That is the key.
   **Do not paste it into a chat, an issue, or this file.**

2. Go to <https://vercel.com/dashboard> and open the **toolgraph** project.
3. Click **Settings** in the top row, then **Environment Variables** in the left
   column.
4. Click **Add Another** (or **Add New** if the list is empty) and fill in:
   - **Key**: `CREDENTIAL_ENCRYPTION_KEY`
   - **Value**: the line from step 1
   - **Environments**: tick **Production**. Tick Preview too if you want the
     feature on preview deploys; leave Development unticked unless you also want
     it locally.
5. Click **Save**.
6. **A redeploy is required** — Vercel only reads environment variables at build
   time. Go to the **Deployments** tab, find the most recent deployment, click
   the **⋯** menu on its row, and choose **Redeploy**. Leave "Use existing build
   cache" ticked.

**How to check it worked.** Sign in, go to **Settings → Security**, and look at
the "Stored connection credentials" card. Before: "Not configured on this
deployment." After: three paragraphs describing the encryption. That text is
driven by whether the key is actually readable by the server, so it cannot say
the wrong thing.

> **Once this is set, do not change it.** Every stored credential is encrypted
> under it. A new key does not fail loudly — it silently stops decrypting, and
> every user has to re-enter their tokens. If you ever must rotate it, that needs
> a migration that decrypts with the old key and re-encrypts with the new one.

**Is it a secret?** Yes, the most sensitive one in the project. It belongs in
Vercel only. The engine on Render does not need it — credentials are decrypted
in the web app and sent to the engine over TLS, exactly as a browser-typed one
already is.

---

## 2. Fix the confirmation email (Supabase SMTP)

**What it fixes.** This is the one production blocker carried over from before
this pass. Supabase's built-in email sender is rate limited to a handful of
messages an hour, and when it fails, signup returns an error. The app already
handles that failure gracefully and says what happened rather than showing a raw
500 — but the person still cannot confirm their address.

You already have a Resend account and `RESEND_API_KEY` configured, so this is
pointing Supabase at it.

1. Go to <https://supabase.com/dashboard>, open your **toolgraph** project.
2. Left sidebar → **Project Settings** (gear icon) → **Authentication**.
3. Scroll to **SMTP Settings** and turn on **Enable Custom SMTP**.
4. Fill in:
   - **Sender email**: the address you verified in Resend, e.g.
     `noreply@toolgraph.dev`
   - **Sender name**: `Toolgraph`
   - **Host**: `smtp.resend.com`
   - **Port number**: `465`
   - **Username**: `resend` (literally that word)
   - **Password**: a Resend API key. Get one at
     <https://resend.com/api-keys> → **Create API Key** → give it **Sending
     access** → copy the value it shows once.
5. Click **Save**.

**No redeploy needed** — this is Supabase-side and takes effect immediately.

**How to check it worked.** Sign up at <https://www.toolgraph.dev/signup> with a
real address you can read. The confirmation email should arrive within about a
minute. If it does not, Supabase logs the reason under **Authentication → Logs**.

**Is it a secret?** The Resend API key is. It goes into the Supabase dashboard
field and nowhere else.

---

## 3. Make the canonical hostname the one that actually serves the site

**What is wrong right now.** `toolgraph.dev` and `www.toolgraph.dev` both work,
but they are not equals: Vercel serves the site on `www` and 308-redirects the
apex to it. Meanwhile `NEXT_PUBLIC_SITE_URL` is set to the apex, and that
variable is what every canonical URL, every sitemap entry and the `og:image` URL
are built from.

So the site currently tells search engines "the real address of this page is
`https://toolgraph.dev/pricing`", and that address answers "no it isn't, go to
`www`". Nothing is visibly broken — a person clicking either one lands on the
right page — but it is a contradictory signal, and it means Google decides for
itself which hostname to index rather than being told.

This predates the current release; it only became visible because there was no
canonical tag at all before.

**The fix, and it is two clicks.** Make the apex the primary domain, so the
redirect runs the other way and matches what the code already says.

1. Go to <https://vercel.com/dashboard> and open the **toolgraph** project.
2. Click **Settings**, then **Domains** in the left column.
3. You will see both `toolgraph.dev` and `www.toolgraph.dev`. One of them is
   marked as redirecting to the other — currently the apex redirects to `www`.
4. Find `toolgraph.dev` and set it as the primary: use the **⋯** menu on its row
   and choose **Set as primary domain** (some Vercel versions phrase this as
   editing `www.toolgraph.dev` and setting **Redirect to** → `toolgraph.dev`).
5. Save. **No redeploy is needed** — this is a routing change, not a build one.

**If you would rather keep `www` as the public address**, that is equally fine —
it is a taste call, not a technical one. In that case do the opposite:

1. Vercel → **toolgraph** → **Settings** → **Environment Variables**.
2. Change `NEXT_PUBLIC_SITE_URL` from `https://toolgraph.dev` to
   `https://www.toolgraph.dev` (no trailing slash).
3. Redeploy (**Deployments** → **⋯** → **Redeploy**).
4. Add a repository variable so the deploy check agrees: GitHub → the repo →
   **Settings** → **Secrets and variables** → **Actions** → **Variables** tab →
   **New repository variable**, named `SITE_URL`, value
   `https://www.toolgraph.dev`.
5. Two other places name the site and should be checked for consistency:
   - **Render** → the engine service → **Environment** →
     `ENGINE_ALLOWED_ORIGINS` should list whichever host browsers will use.
   - **Supabase** → **Authentication** → **URL Configuration** → the **Site URL**
     and **Redirect URLs** should match, or GitHub sign-in will bounce.

**How to check it worked.** Run this from any terminal:

```
node scripts/verify-canonical.mjs --site https://toolgraph.dev
```

(or with `--site https://www.toolgraph.dev` if you took the second route). It
prints one OK line, or tells you exactly what disagrees. The same check runs on
every deploy — it does not block the deploy, but it writes a warning into the
workflow summary until this is resolved.

**Is it a secret?** No. Both hostnames are public.

---

## 4. Submit the sitemap to Google

**What it fixes.** Nothing is broken; this just tells Google the site exists
rather than waiting to be found.

1. Go to <https://search.google.com/search-console>.
2. Add a property, choosing **URL prefix**, and enter `https://www.toolgraph.dev`.
3. Verify ownership. The easiest route is the **HTML tag** method: Google gives
   you a `<meta name="google-site-verification" content="...">` tag. Rather than
   pasting it into the code, use the **Domain name provider** method instead and
   add the TXT record Google gives you in Namecheap → Advanced DNS.
4. Once verified, open **Sitemaps** in the left sidebar, enter `sitemap.xml`, and
   click **Submit**.

**How to check it worked.** Search Console shows the sitemap as "Success" with a
count of discovered URLs (it should find 6). It can take a day.

**Is it a secret?** No.

---

## 5. Optional — raise the run timeout for shared connections

**What this is about, in plain terms.** Running a graph normally goes straight
from your browser to the execution engine, and can take as long as it likes. But
when a graph uses a saved connection that has a stored credential, the run has to
go through the Toolgraph server instead — because the credential is decrypted
there and must never reach a browser. Serverless functions have a time limit, and
Toolgraph sets it to the maximum the plan allows (60 seconds).

The engine sleeps after 15 minutes of inactivity and takes most of a minute to
wake, so a cold start plus a long run can exceed that 60 seconds. The user sees
an honest message saying the engine did not wake in time, and retrying works
because the engine is then warm.

**If that becomes annoying**, there are two fixes and neither needs code:

- **Keep the engine awake.** On Render, upgrade the engine service off the free
  tier so it stops sleeping. That removes the cold start entirely and is the
  bigger win.
- **Raise the function limit.** On Vercel Pro, `maxDuration` can go to 300
  seconds. The value is set in `apps/web/src/app/api/run/route.ts` and would need
  changing there and redeploying.

**How to check.** Watch how often anyone actually hits it. If nobody does, this
needs nothing.

---

## Not required, and deliberately so

- **No card processor.** Billing is crypto-only and settled by reading the chain.
  There are no Stripe price IDs to create, for monthly, annual or Team — the
  amounts are computed by `priceUsd()` from the plan table in
  `apps/web/src/lib/billing/plan.ts`.
- **No OAuth apps beyond GitHub sign-in.** No first-party Google, Supabase or
  Slack integrations were added, so there are no client IDs or secrets to
  register. Adding one later would need its own dashboard steps.
- **No new Upstash, Sentry or PostHog configuration.** The new rate-limit
  policies use the Upstash connection that already exists.
