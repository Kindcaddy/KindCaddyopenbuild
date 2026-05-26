# Tests — supplemental harnesses

This directory holds the **non-Jest** test harnesses: end-to-end (Playwright) and load (k6).

The primary test suite lives in [`../__tests__/`](../__tests__/) and runs via `npm test`. See [`../../TESTING.md`](../../TESTING.md) for the full pyramid and per-file threat model.

## Layout

```
tests/
├── e2e/                 Playwright — browser-driven flows
│   └── login.spec.ts    @smoke — login + redirect + cookie + /api/me round-trip
└── load/                k6 — load and stress
    └── chat-turn-ratelimit.js   verifies the rate limiter degrades to 429s, not 500s
```

## Running e2e (Playwright)

```bash
# One-time
npx playwright install --with-deps

# Start the dev server (in another terminal)
npm run dev

# Run all e2e
npx playwright test

# Run only the @smoke tag (post-deploy verification, ~10s)
npx playwright test --grep @smoke
```

These are intentionally minimal today — they exist to prove the pyramid is wired, not to provide exhaustive coverage. See `TESTING.md` §3 for the planned expansion.

## Running load (k6)

```bash
# Install k6: brew install k6 (macOS) / see k6.io/docs/getting-started/installation
# Seed a demo user (or grab a real auth_session cookie value)
npm run db:reset

# Run against local
k6 run \
  -e BASE_URL=http://localhost:3000 \
  -e TEST_COOKIE='demo-user-id:demo-tenant-id' \
  tests/load/chat-turn-ratelimit.js
```

The load tests are **never run against production**. Staging only. They're configured to exercise the rate limiter, which by design will produce a high 429 rate — useful in staging, noisy in prod alerting.

## Why these are separate from Jest

Jest is great for fast, in-process tests. Playwright and k6 each pull in heavy dependencies (real browsers, a Go-based load runner) that we don't want in the default `npm test` path. Keeping them here means a contributor can `npm ci && npm test` without downloading 200 MB of Chromium.
