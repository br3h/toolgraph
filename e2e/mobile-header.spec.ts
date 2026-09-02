import { expect, test, type Page } from '@playwright/test';

/**
 * The header at phone widths.
 *
 * Horizontal overflow is the failure these guard against: it is invisible on a
 * desktop run, trivial to reintroduce, and makes a page feel broken on the one
 * device most people arrive on.
 */

const VIEWPORTS = [
  { name: 'iPhone SE', width: 320, height: 568 },
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'small tablet', width: 600, height: 900 },
];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`header at ${viewport.name} (${viewport.width}px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('shows the wordmark and a trigger, and hides the desktop nav', async ({ page }) => {
      await page.goto('/');

      // The brand stays put, which is the whole point of collapsing the rest.
      await expect(page.getByRole('link', { name: 'Toolgraph' })).toBeVisible();
      await expect(page.getByTestId('mobile-nav-toggle')).toBeVisible();

      // The full nav must be genuinely hidden, not merely overflowing offscreen.
      await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeHidden();
    });

    test('does not scroll sideways, open or closed', async ({ page }) => {
      await page.goto('/');
      expect(await horizontalOverflow(page), 'closed').toBeLessThanOrEqual(0);

      await page.getByTestId('mobile-nav-toggle').click();
      await expect(page.getByTestId('mobile-nav-panel')).toBeVisible();
      expect(await horizontalOverflow(page), 'panel open').toBeLessThanOrEqual(0);
    });

    test('keeps the header controls inside the viewport', async ({ page }) => {
      await page.goto('/');

      for (const testId of ['mobile-nav-toggle']) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box, testId).not.toBeNull();
        expect(box!.x, `${testId} left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${testId} right edge`).toBeLessThanOrEqual(viewport.width);
      }

      // Roughly 16px of breathing room from each edge, as asked.
      const brand = await page.getByRole('link', { name: 'Toolgraph' }).boundingBox();
      expect(brand!.x).toBeGreaterThanOrEqual(12);

      const trigger = await page.getByTestId('mobile-nav-toggle').boundingBox();
      expect(viewport.width - (trigger!.x + trigger!.width)).toBeGreaterThanOrEqual(12);
    });

    test('the brand and the trigger never overlap', async ({ page }) => {
      await page.goto('/');
      const brand = (await page.getByRole('link', { name: 'Toolgraph' }).boundingBox())!;
      const trigger = (await page.getByTestId('mobile-nav-toggle').boundingBox())!;
      expect(brand.x + brand.width, 'brand runs into the trigger').toBeLessThanOrEqual(trigger.x);
    });
  });
}

test.describe('the menu itself', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens, lists every destination, and closes again', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByTestId('mobile-nav-toggle');

    await expect(page.getByTestId('mobile-nav-panel')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    const panel = page.getByTestId('mobile-nav-panel');
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    for (const label of ['Pricing', 'GitHub', 'Sign in', 'Get started']) {
      await expect(panel.getByRole('link', { name: label })).toBeVisible();
    }

    await toggle.click();
    await expect(page.getByTestId('mobile-nav-panel')).toHaveCount(0);
  });

  test('closes on Escape and returns focus to the trigger', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('mobile-nav-toggle').click();
    await expect(page.getByTestId('mobile-nav-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mobile-nav-panel')).toHaveCount(0);
    await expect(page.getByTestId('mobile-nav-toggle')).toBeFocused();
  });

  test('closes when clicking outside it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('mobile-nav-toggle').click();
    await expect(page.getByTestId('mobile-nav-panel')).toBeVisible();

    await page.locator('h1').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('mobile-nav-panel')).toHaveCount(0);
  });

  test('a destination navigates and the panel does not survive it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('mobile-nav-toggle').click();
    await page.getByTestId('mobile-nav-panel').getByRole('link', { name: 'Pricing' }).click();

    await page.waitForURL(/\/pricing/);
    await expect(page.getByTestId('mobile-nav-panel')).toHaveCount(0);
  });
});

test.describe('the desktop header is untouched', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('shows the full nav and no trigger', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Get started', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pricing', exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('mobile-nav-toggle')).toBeHidden();
  });
});
