import { expect, test } from '@playwright/test';

/**
 * The smoke test the definition of done calls for: sign up, create a graph, see
 * it on the canvas. It is deliberately shallow and fast — its job is to catch a
 * deploy that is fundamentally broken, not to test behaviour that unit tests
 * already cover.
 */

/** A unique address per run so repeated runs never collide on an existing user. */
function uniqueEmail(): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return `toolgraph-e2e-${suffix}@example.com`;
}

const PASSWORD = 'e2e-Test-Password-9f3a!';

test.describe('health', () => {
  test('web health endpoint reports build info', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
    // Present so a deploy check can confirm which commit is actually live.
    expect(body).toHaveProperty('commit');
    expect(body).toHaveProperty('version');
  });

  test('web health endpoint is not cached', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.headers()['cache-control']).toContain('no-store');
  });

  test('security headers are present', async ({ request }) => {
    const res = await request.get('/');
    const headers = res.headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');

    const csp = headers['content-security-policy'];
    expect(csp, 'a Content-Security-Policy must be set').toBeTruthy();
    // The two properties that matter most: no dynamic execution, and a nonce
    // rather than a blanket unsafe-inline.
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain('nonce-');

    // HSTS is only emitted over HTTPS; a local http run legitimately lacks it.
    const url = new URL(res.url());
    if (url.protocol === 'https:') {
      expect(headers['strict-transport-security']).toContain('max-age=');
    }
  });
});

test.describe('signup to canvas', () => {
  test('a new user can sign up, create a graph and see the canvas', async ({ page }) => {
    const email = uniqueEmail();

    // --- sign up ---------------------------------------------------------
    await page.goto('/signup');
    await page.getByTestId('signup-email').fill(email);
    await page.getByTestId('signup-password').fill(PASSWORD);
    await page.getByTestId('signup-submit').click();

    /*
     * Two legitimate outcomes, depending on the project's configuration.
     *
     * CI runs against a local Supabase stack, which auto-confirms, so signup
     * yields a session and lands on the graphs list — and the rest of this test
     * exercises the canvas. A hosted project with email confirmation on instead
     * shows the "check your inbox" notice and issues no session. Asserting only
     * the first made this test fail against production for a reason that was
     * not a defect.
     */
    const landed = page.waitForURL(/\/graphs/, { timeout: 45_000 }).then(() => 'session' as const);
    const notice = page
      .getByTestId('auth-notice')
      .waitFor({ state: 'visible', timeout: 45_000 })
      .then(() => 'confirm' as const);

    const outcome = await Promise.race([landed, notice]);

    if (outcome === 'confirm') {
      // The signup itself succeeded, which is what this step proves. The
      // authenticated flow beyond it needs a confirmed account, and CI covers
      // that against the local stack.
      await expect(page.getByTestId('auth-notice')).toContainText(/confirm/i);
      test.info().annotations.push({
        type: 'note',
        description:
          'Email confirmation is enabled on this project, so signup issues no session. ' +
          'The canvas portion of this test runs in CI against the local stack.',
      });
      return;
    }

    await expect(page.getByTestId('graph-list')).toBeVisible();

    // --- create a graph --------------------------------------------------
    await page.getByTestId('new-graph-button').click();
    await page.waitForURL(/\/graphs\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // --- see it on the canvas -------------------------------------------
    const canvas = page.getByTestId('canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    // reactflow renders its viewport inside the canvas root once it mounts.
    await expect(canvas.locator('.react-flow__viewport')).toBeAttached({ timeout: 30_000 });

    // --- and it persists -------------------------------------------------
    const graphUrl = page.url();
    await page.reload();
    await expect(page.getByTestId('canvas')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toBe(graphUrl);

    // It shows up in the list too.
    await page.goto('/graphs');
    await expect(page.getByTestId('graph-card').first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('unauthenticated access', () => {
  test('the graphs list redirects a signed-out visitor to login', async ({ page }) => {
    await page.goto('/graphs');
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});

test.describe('branding and the homepage demo', () => {
  test('the document title is exactly the wordmark', async ({ page }) => {
    await page.goto('/');
    expect(await page.title()).toBe('Toolgraph');
  });

  test('the auth pages carry no route suffix either', async ({ page }) => {
    // The root metadata sets `title` as a plain string with no `template`, so a
    // route that declares nothing inherits the bare wordmark. The auth pages
    // deliberately declare nothing: they are not content anybody searches for,
    // and "Sign in · Toolgraph" in a tab adds nothing.
    for (const path of ['/login', '/signup']) {
      await page.goto(path);
      expect(await page.title(), `${path} should not append a suffix`).toBe('Toolgraph');
    }
  });

  test('the public content pages carry their own clean title', async ({ page }) => {
    /*
     * The homepage is the one page whose tab must read exactly the wordmark,
     * and the assertion above covers it. Everywhere else a searcher can land,
     * a bare "Toolgraph" is a worse result than a titled one — a search listing
     * and a tab strip both need to say which page this is.
     *
     * The `| Toolgraph` half is written per route rather than by a metadata
     * template, because a template would also append itself to the homepage.
     */
    for (const [path, title] of [
      ['/pricing', 'Pricing | Toolgraph'],
      ['/docs', 'Docs | Toolgraph'],
      ['/security', 'Security | Toolgraph'],
      ['/privacy', 'Privacy | Toolgraph'],
      ['/terms', 'Terms | Toolgraph'],
    ] as const) {
      await page.goto(path);
      expect(await page.title(), `${path} should be titled`).toBe(title);
    }
  });

  test('the favicon is served directly and declared with sizes', async ({ page, request }) => {
    const ico = await request.get('/favicon.ico');
    expect(ico.status()).toBe(200);
    expect(ico.headers()['content-type']).toContain('icon');
    // A multi-size ICO, not a one-pixel placeholder.
    expect((await ico.body()).byteLength).toBeGreaterThan(1000);

    await page.goto('/');
    // Next's file convention emits sizes and type; a metadata override would
    // replace these with a single bare tag, which is what broke it before.
    const declared = await page
      .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
      .evaluateAll((links) =>
        links.map((l) => ({
          href: l.getAttribute('href'),
          sizes: l.getAttribute('sizes'),
          type: l.getAttribute('type'),
        })),
      );

    expect(declared.length).toBeGreaterThanOrEqual(2);
    expect(declared.every((l) => l.sizes && l.type)).toBe(true);
    expect(declared.some((l) => (l.href ?? '').includes('favicon.ico'))).toBe(true);
  });

  test('the homepage demo is drawn live, with no video element', async ({ page }) => {
    await page.goto('/');

    // The old implementation. None of it may come back.
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.locator('source')).toHaveCount(0);

    const demo = page.getByRole('img', { name: /connection is drawn from createUser/i });
    await expect(demo).toBeVisible();

    // Populated on first paint rather than an empty frame waiting for hydration.
    await expect(demo.locator('text=createUser')).toBeVisible();
    await expect(demo.locator('text=sendEmail')).toBeVisible();
  });

  test('the demo animates on its own after a hard reload', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });

    const demo = page.getByRole('img', { name: /connection is drawn from createUser/i });
    await expect(demo).toBeVisible();

    // No interaction of any kind: the mismatch explanation must appear by
    // itself within one cycle of the timeline.
    await expect(page.locator('text=That connection would not type-check')).toBeVisible({
      timeout: 20_000,
    });

    // And the sequence must move on rather than freezing on that frame.
    await expect(page.locator('text=Types compatible')).toBeVisible({ timeout: 20_000 });
  });

  test('the homepage logs no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('/', { waitUntil: 'networkidle' });
    // Let a full cycle of the demo run, so a timer or transition fault surfaces.
    await page.waitForTimeout(12_000);

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
