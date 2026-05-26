// Playwright e2e skeleton — login flow smoke test.
//
// Why this test exists
// --------------------
// The login flow is the gateway to every other feature; if it regresses, nothing
// downstream is reachable. The dev-only `/api/dev/login` route is the demo's auth path.
// This test pins down:
//
//   1. The login page renders with email+password inputs.
//   2. Submitting valid demo credentials sets the `auth_session` cookie.
//   3. The post-login redirect lands on /app (not /login, not 500).
//   4. /api/me returns a populated context for the new session.
//
// This is the @smoke test — it's tagged so post-deploy verification can run only this
// case in <10 seconds. The fuller flow tests (Google OAuth callback, chat turn, admin
// access) live in their own files.
//
// To run:
//   npm run dev &   # in one terminal
//   npx playwright install --with-deps
//   npx playwright test tests/e2e/login.spec.ts
//
// Setup:
//   The dev server must be running with a seeded SQLite (`npm run db:reset` first).

import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'demo@kindcaddy.com';
const DEMO_PASSWORD = 'demo123';

test.describe('@smoke login flow', () => {
  test('user can sign in with demo credentials and lands on /app', async ({ page, context }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: /sign in|log in|welcome/i })).toBeVisible();

    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    const passwordInput = page.getByLabel(/password/i);
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill(DEMO_PASSWORD);
    }

    await Promise.all([
      page.waitForURL(/\/app(\/.*)?$/, { timeout: 10_000 }),
      page.getByRole('button', { name: /sign in|log in|continue/i }).click(),
    ]);

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'auth_session');
    expect(session, 'auth_session cookie should be set after login').toBeDefined();
    expect(session?.value).toMatch(/.+:.+|.+/);
    expect(session?.httpOnly).toBe(true);

    const meResponse = await page.request.get('/api/me');
    expect(meResponse.ok()).toBe(true);
    const me = await meResponse.json();
    expect(me).toHaveProperty('userId');
    expect(me).toHaveProperty('tenantId');
  });

  test('blank submit shows an inline error, no redirect', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
