# Testing

What's tested, how it's tested, and what the test suite is actually pinning down.

This is not a coverage-percentage document — coverage as a goal produces tests that exist to satisfy a metric. This document explains the **threat model the tests defend against**, why each layer of the pyramid exists, and what would break if a given test were deleted.

---

## 1. The test pyramid

```
                          ┌──────────────────┐
                          │  Load / Stress   │  ← k6 (scaffolded, runs on demand)
                          │      (k6)        │
                          └──────────────────┘
                       ┌────────────────────────┐
                       │      E2E (browser)     │  ← Playwright (skeleton, see tests/e2e/)
                       │      Playwright        │
                       └────────────────────────┘
                  ┌────────────────────────────────┐
                  │       Integration              │  ← Jest + real Prisma + test SQLite
                  │   Tenant + dept isolation,     │
                  │   API routes with withGuard    │
                  └────────────────────────────────┘
              ┌──────────────────────────────────────────┐
              │              Unit                        │  ← Jest, no I/O
              │  auth parser, RBAC matrix, policy gate,  │
              │  rate limiter, Hermes message shaper     │
              └──────────────────────────────────────────┘
```

The shape is intentional: most failures are caught cheaply (unit), the most expensive failures (cross-tenant data leak, RBAC bypass) are caught at the integration layer with a real database, and a thin layer of e2e + load tests guards the user-visible contracts.

---

## 2. What's in the repo today

| Layer | File | What it pins down |
|---|---|---|
| Unit | `__tests__/lib/auth.test.ts` | Cookie parser: canonical shape, empty/missing handling, round-trip with `setAuthCookie`, security flags (httpOnly, sameSite=lax, 7-day expiry). A bug here is "authenticate as anyone" by definition. |
| Unit | `__tests__/lib/rbac.test.ts` | Role capability matrix (`employee` → `resources:read`; `admin` → `*` wildcard). Pins the fail-closed default for unknown roles, the wildcard semantics for `admin`, and the `isAdmin` helper. |
| Unit | `__tests__/lib/mcp/policy.test.ts` | The policy gate: rate-limit token bucket (30 burst, 1 rps), RBAC denial path, tenant-domain scoping, department scope filter. Verifies denied calls never reach `server.invoke()`. |
| Unit | `__tests__/lib/agents/hermes-projection.test.ts` | Tool-catalog projection: given an MCP registry + a request context, the Hermes-facing tool list contains exactly the tools the user is allowed to call. Catches the "model sees a tool it can't use" regression. |
| Integration | `__tests__/integration/tenant-isolation.test.ts` | Real Prisma against `test.db`. Two tenants, overlapping resource names. Every cross-tenant read/write is asserted to return 404 or 403, never the wrong tenant's data. |
| Integration | `__tests__/integration/chat-procurement-vs-finance.test.ts` | The department-scope test. A user in the Procurement department asks an MCP-backed question that would only succeed if the gate is leaking. Asserts the Finance department's invoices are invisible — at the tool-result level, not just the UI level. |
| API | `__tests__/api/resources.test.ts` | The `/api/resources` route end-to-end through `withGuard`. Auth missing → 401, auth wrong tenant → 404 (not 403, to avoid revealing existence), auth correct → JSON contract. |

Each test file opens with a `Why this test exists` doc-comment explaining the regression it's defending against. Read those before changing any of these tests — if you can't articulate which threat the test defends, do not delete it.

---

## 3. The threats each layer catches

### Unit layer

| Threat | Pinned by |
|---|---|
| Cookie parser regression (e.g. empty cookie treated as `userId: ''`) | `auth.test.ts` |
| RBAC role weakening (`employee` accidentally gains a write permission via wildcard misuse) | `rbac.test.ts` |
| Rate limiter is wired in but doesn't actually limit (returns `allow` for everything) | `policy.test.ts` |
| Department scope check is logged but not enforced | `policy.test.ts` |
| Tool projection leaks a tool the user can't invoke (model sees QB tools as a Procurement user) | `hermes-projection.test.ts` |

### Integration layer

| Threat | Pinned by |
|---|---|
| Two tenants in the same DB; tenant A reads tenant B's resources via a forged path param | `tenant-isolation.test.ts` |
| Department isolation: a Procurement user gets a Finance invoice in chat tool output | `chat-procurement-vs-finance.test.ts` |
| API route forgets to call `withGuard`, regresses to "no auth required" | `resources.test.ts` |
| Wrong-tenant lookup returns 200 with data (should be 404) | `resources.test.ts` |

### E2E layer (skeleton, expand as needed)

| Threat | Planned coverage |
|---|---|
| Login flow regression (login form posts wrong shape, redirect breaks) | `tests/e2e/login.spec.ts` |
| Assistant chat surface produces a reply | `tests/e2e/chat.spec.ts` |
| Google OAuth callback persists a `Resource` row | `tests/e2e/google-oauth.spec.ts` |

### Load layer (skeleton)

| Threat | Planned coverage |
|---|---|
| Rate limiter degrades to 500s instead of 429s under burst | `tests/load/chat-turn-ratelimit.js` |
| Memory growth on the Next.js process during sustained chat traffic | `tests/load/chat-soak.js` |

---

## 4. Running the tests

```bash
cd frontend
npm ci

# Unit + integration (fast, every PR)
npm test

# Watch mode while developing
npm run test:watch

# Coverage report
npm test -- --coverage

# E2E (requires Playwright, against a running dev server)
npm run dev &                       # in one terminal
npx playwright test                 # in another

# Load (requires k6 + a running staging/local server)
k6 run tests/load/chat-turn-ratelimit.js
```

The test database lives at `frontend/test.db`. It's gitignored; each test run recreates it from `prisma/schema.prisma` and a deterministic seed.

---

## 5. The end-to-end RBAC + department policy validation

The most important guarantee Kindcaddy makes is: **no model output can leak data across departments or tenants, regardless of what the model decides to do.** This is validated by three converging tests:

1. **`policy.test.ts`** — the gate's logic is correct in isolation.
2. **`hermes-projection.test.ts`** — the LLM never receives a tool it can't call.
3. **`chat-procurement-vs-finance.test.ts`** — given (1) and (2), an actual chat turn from a Procurement user against a Finance-only resource returns no data, no error trace that reveals existence, no side-channel.

Test (3) was deliberately run against a real Claude API endpoint and against a local Gemma model during development — same outcome in both. The policy gate is the load-bearing wall, and the LLM's choices are irrelevant to the correctness of the answer.

---

## 6. What's not tested (yet)

Honesty matters more than coverage numbers. Today's gaps:

| Gap | Risk | Priority |
|---|---|---|
| No fuzz testing of the policy gate (random tools × random contexts) | Medium — manual cases cover the high-value paths | P3 |
| No contract tests against the real Hermes service (only against the mock) | Low — Hermes is OpenAI-compatible; the OpenAI adapter covers the wire format | P3 |
| No tests for the Google OAuth callback handler | Medium — manual smoke test today | P2 |
| No chaos tests (Hermes down, DB connection drops) | Low — graceful degradation paths exist but aren't asserted | P3 |
| No accessibility tests on UI | Low — UI is admin-facing, not consumer-facing | P3 |

Each will be addressed in priority order. Filing an issue for any of them is welcome.

---

## 7. The principle behind the suite

> A test exists to prevent a specific regression you are afraid of. If you can't name the regression a test prevents, you don't have a test — you have a coverage line.

Every test in this repo has a named threat. When you propose adding one, write the `Why this test exists` comment first.
