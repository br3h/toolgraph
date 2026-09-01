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

    // Lands somewhere signed-in. The graphs list is the post-signup destination.
    await page.waitForURL(/\/graphs/, { timeout: 45_000 });
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
