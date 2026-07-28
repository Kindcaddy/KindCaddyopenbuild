# Kindcaddy

> A production-deployed, multi-tenant AI platform that talks to your business systems — with code-enforced RBAC, department-level data scoping, per-user memory, bring-your-own-key, and an auditable tool-use trail.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)

Kindcaddy is a production AI assistant platform that:

- Is **safe to point at real business data** — every chat turn flows through an auth guard (NextAuth v5 + CSRF origin checks), an RBAC capability check, a rate limiter, and a department-scope filter before any tool is invoked.
- **Doesn't trust the model** — the LLM never sees data the user can't see, never reaches a tool the user can't call, and can't escape the active tenant's MCP domain. Policy is enforced in code, not in the prompt.
- **Audits everything** — every tool call writes a `ToolInvocation` row (pending → ok/error/denied with latency) before the tool runs; every chat turn writes an `AuditEvent`. Unexpected failures persist as `ErrorReport` rows with a triage workflow (open → acknowledged → resolved). You can reconstruct any user action from the database alone.
- **Supports bring-your-own-key** — users can supply their own API key (OpenRouter, OpenAI, or any OpenAI-compatible endpoint). The key lives only in an encrypted httpOnly session cookie — never in the database.
- **Has per-user memory** — smart (auto-extracted), explicit (user-saved), or off. Every memory read/write is scoped to `(userId, tenantId)` — one user's memory can never surface in another's answer.

---

## Quickstart

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or use the Dockerfile for a containerized deployment)
- An OpenAI-compatible API key (OpenRouter, OpenAI, or local llama.cpp/Ollama)

### Setup

```bash
git clone https://github.com/Kindcaddy/KindCaddyopenbuild.git
cd KindCaddyopenbuild/frontend
cp .env.example .env
# Edit .env: set DATABASE_URL, AUTH_SECRET, RESOURCE_ENCRYPTION_KEY, OPENAI_API_KEY
npm ci
npm run db:reset          # creates schema + seeds demo users, tenants, departments
npm run dev               # http://localhost:3000
```

Sign in at `/login` with the demo account (dev-only, gated behind `NODE_ENV !== 'production'`):

| Role | Email | Password |
|------|-------|----------|
| Demo user | `demo@kindcaddy.com` | `demo123` |

### Optional: BYOK (Bring Your Own Key)

Users can supply their own API key via `/app/configuration`. The key is encrypted (AES-256-GCM) and stored only in an httpOnly session cookie — it never touches the database. When active, the user's key, base URL, and model override the platform defaults for that session only.

### Optional: Local Model

Set `OPENAI_BASE_URL` to any OpenAI-compatible endpoint:

```bash
# OpenRouter (production default)
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=anthropic/claude-3.5-sonnet

# Local llama.cpp / Ollama
OPENAI_BASE_URL=http://127.0.0.1:8080/v1
OPENAI_MODEL=local-model
```

---

## What's Inside

```
kindcaddy/
├── frontend/
│   ├── app/
│   │   ├── app/               # Customer UI (assistant, profile, config, integrations)
│   │   ├── admin/              # Admin UI (users, errors, system settings)
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/  # NextAuth v5 sign-in flow
│   │   │   ├── auth/bridge/    # Redeems invite tokens → creates tenant membership
│   │   │   ├── mcp/            # Chat, audit, tools, sessions, domains
│   │   │   ├── me/             # BYOK, export, profile
│   │   │   ├── memory/         # Memory mode toggle
│   │   │   ├── integrations/   # Google Calendar + QuickBooks OAuth
│   │   │   ├── invites/        # Invite token redemption
│   │   │   ├── health/         # Health check endpoint
│   │   │   └── dev/            # Dev-only login (production 404s)
│   │   └── login/              # Login + invite redemption
│   ├── lib/
│   │   ├── agents/             # KindCaddyAgent — OpenAI-compatible agent runtime
│   │   ├── mcp/                # MCP framework (client, policy, registry, servers)
│   │   ├── llm/                # OpenAI-compatible provider adapter
│   │   ├── host/               # Orchestrator + session manager
│   │   ├── integrations/       # Google Calendar, QuickBooks Online
│   │   ├── memory/             # Per-user memory store (smart/explicit/off)
│   │   ├── auth.ts             # Session cookie management
│   │   ├── auth-provider.ts    # NextAuth v5 configuration
│   │   ├── byok.ts             # Bring-your-own-key (encrypted session cookie)
│   │   ├── crypto.ts           # AES-256-GCM encryption + HMAC state signing
│   │   ├── errors.ts           # AppError + ErrorReport triage system
│   │   ├── guard.ts            # withGuard: auth + CSRF + RBAC + error handling
│   │   ├── rate-limit.ts       # Chat-turn rate limiter + concurrency semaphore
│   │   ├── rbac.ts             # Role → capability map
│   │   └── context.ts          # RequestContext (userId, tenantId, role, department)
│   ├── prisma/
│   │   ├── schema.prisma       # 14 models (User, Tenant, Department, Membership,
│   │   │                        #   Resource, AuditEvent, ErrorReport, ChatSession,
│   │   │                        #   ChatMessage, ToolInvocation, UserMemory, Invite,
│   │   │                        #   Account, Session, VerificationToken, ...)
│   │   ├── migrations/         # PostgreSQL migrations
│   │   └── seed.ts             # Demo data
│   ├── __tests__/              # Unit + integration tests
│   ├── Dockerfile              # Containerized deployment
│   └── .env.production.example # Production environment template
└── infra/                       # Terraform IaC for AWS
```

---

## Core Architecture

### The Policy Gate (`lib/mcp/policy.ts`)

Every tool call passes through `evaluatePolicy()` which runs 4 independent checks in series. First failure wins; its `gate` label (`'role' | 'scope' | 'rate'`) rides out to the audit log.

```
   Tool call ──▶  RBAC role check  ──┐
                   (capability vs      │
                    role)              │
                                       ├──▶ allow / deny
                   Department scope  ──┤
                   (public /            │
                    own_department /   │
                    {department} /     │
                    tenant_admin)      │
                                       │
                   Rate limit          ──┘
                   (token bucket per
                    tenant + user)
```

The LLM **cannot reach a denied tool** — denied tools are stripped from the catalog before the model sees them (`lib/agents/tool-projection.ts`). Even if the model invents a tool name, the gate rejects it at invoke time.

**Role system:** Two roles — `admin` and `employee`. `admin` gets wildcard capability (`*`); `employee` gets `resources:read`. See `lib/rbac.ts`.

**Department-as-clearance:** Company-wide (`tenant_admin`) data access is granted by membership in the "Executive" department — NOT by role. A Procurement admin cannot see company-wide P&L; an Executive employee can. Role and data scope are orthogonal axes.

### Audit-By-Construction

| Event | Where It's Logged | When |
|---|---|---|
| Tool call | `ToolInvocation` (status: pending → ok/error/denied, latencyMs, params, result) | Before tool executes, updated after |
| Chat turn | `AuditEvent` (userId, tenantId, action, metadata) | After each turn completes |
| Unexpected failure | `ErrorReport` (code, message, stack, severity, triage status) | When the system breaks — not when policy denies |
| Policy denial | `ToolInvocation` (status: denied, reason, gate) | When the gate blocks a call |

Policy denials are NOT errors — they never create `ErrorReport` rows. The gate working is expected behavior; the system saying "no" is not the system being broken.

### Error Handling (`lib/errors.ts`)

Two kinds of failure, two paths:

- **AppError** — expected failures (bad input, missing session, rate limited). Maps to clean HTTP responses. NOT persisted.
- **reportError()** — unexpected failures. Persists an `ErrorReport` row with triage workflow (open → acknowledged → resolved). Best-effort: if the DB write fails, falls back to stderr. Never takes the request down with it.

Every response carries an `x-request-id` header that correlates to server logs and ErrorReport rows.

### BYOK — Bring Your Own Key (`lib/byok.ts`)

Users can supply their own API key, base URL, and model via `/app/configuration`. The key:

- Lives ONLY in an encrypted httpOnly session cookie (`kc_byok`)
- Never touches the database
- Is encrypted with AES-256-GCM (same crypto as integration tokens)
- Is a session cookie (no `maxAge` — clears when the browser closes)
- Degrades gracefully: a bad cookie returns null, falling back to the platform key — never 500s a chat

### Per-User Memory (`lib/memory/store.ts`)

Three modes: `smart` (auto-extract after each turn), `explicit` (user saves via `memory.*` MCP tools), or `off`.

- Every read/write is scoped to `(userId, tenantId)` — same invariant as ChatSession
- Hard caps: 200 memories per user, 20 injected per turn, 500 chars per memory, 3 extractions per smart turn
- Soft-delete via `archivedAt` (preserves audit trail)
- Schema leaves room for `pgvector` embeddings without reshaping reads

### Rate Limiting + Concurrency Control (`lib/rate-limit.ts`)

Two layers protect the chat pipeline:

1. **chatTurnLimiter** — per-(tenant, user) token bucket (10 burst, 0.2/s sustained). Stops one user from spawning unbounded agent loops.
2. **chatTurnSemaphore** — global counting semaphore (default 8 concurrent). Crash guard: when full, requests fail fast with 429 `busy` instead of queueing until sockets hang.

Both are in-process; move behind Redis when replicas are introduced.

### Agent Runtime (`lib/agents/agent.ts`)

`KindCaddyAgent` — the primary agent runtime. Replaces the retired external Hermes service.

- Calls any OpenAI-compatible `/v1/chat/completions` endpoint (OpenRouter in production)
- Exposes MCP tools to the model as OpenAI-style function specs
- When the model requests a tool, KindCaddy executes it locally through the MCP client
- Turn budget enforcement: if a turn exceeds `LLM_TURN_BUDGET_MS`, returns partial answer + logs warning
- Provider outage detection: after 5 minutes of consecutive failures, escalates severity to `fatal`
- `ByokAuthError`: distinguishes "user's key is bad" (401, not persisted) from "system is broken" (500, ErrorReport)

---

## Security

### Threat Model

| Threat | Defense | Where |
|---|---|---|
| Cross-tenant data leak | Every Prisma query filters by `tenantId` from RequestContext | `lib/guard.ts`, `lib/host/*`, `lib/mcp/servers/*` |
| Cross-department data leak | Resources have `departmentId`; queries filter by both `tenantId` AND `departmentId` | `lib/host/host.ts`, `lib/mcp/policy.ts` |
| Privilege escalation via tool call | RBAC capability check in the policy gate before any tool runs | `lib/rbac.ts`, `lib/mcp/policy.ts` |
| Model-induced misuse (prompt injection) | LLM never sees a tool it can't call; denied tools stripped from catalog | `lib/agents/tool-projection.ts`, `lib/mcp/policy.ts` |
| Session hijacking via XSS | `auth_session` cookie is `httpOnly`, `sameSite=lax`, `secure` in prod | `lib/auth.ts` |
| CSRF on state-changing routes | Origin header + Sec-Fetch-Site validation on non-GET requests | `lib/guard.ts` |
| API key exfiltration (BYOK) | Key lives only in encrypted httpOnly session cookie, never in DB | `lib/byok.ts` |
| Resource enumeration | Wrong-tenant lookups return 404 (not 403) | `app/api/resources/route.ts` |
| Rate-based DoS | Token-bucket rate limiter per `(tenantId, userId)` + global concurrency semaphore | `lib/mcp/policy.ts`, `lib/rate-limit.ts` |
| Integration token theft | OAuth refresh tokens envelope-encrypted (AES-256-GCM + KMS in prod) | `lib/crypto.ts` |

### Encryption

- **Integration tokens** (Google, QuickBooks OAuth): AES-256-GCM envelope encryption. Key from `RESOURCE_ENCRYPTION_KEY` (KMS-managed in AWS). Ciphertext format: `enc:v1:<iv>:<tag>:<ciphertext>`.
- **BYOK keys**: AES-256-GCM encrypted, stored in httpOnly session cookie only.
- **OAuth state**: HMAC-SHA256 signed with `AUTH_SECRET`, verified with `timingSafeEqual` (timing-attack resistant).

Production fails loudly if `RESOURCE_ENCRYPTION_KEY` or `AUTH_SECRET` is missing. Dev warns once, then passes through (documented).

---

## Testing

### Test Pyramid

```
              ┌────────────────────────┐
              │  Load / Stress (k6)    │  ← scaffolded
              └────────────────────────┘
          ┌────────────────────────────────┐
          │  E2E (Playwright)              │  ← login flow
          └────────────────────────────────┘
      ┌──────────────────────────────────────────┐
      │  Integration                             │  ← Jest + real Prisma + test PostgreSQL
      │  Tenant isolation, dept isolation,       │
      │  API routes with withGuard               │
      └──────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────┐
  │  Unit                                            │  ← Jest, no I/O
  │  auth, RBAC, policy gate, rate limiter,         │
  │  tool projection, crypto, BYOK, errors,         │
  │  onboarding, invites, QBO error classification  │
  └──────────────────────────────────────────────────┘
```

### What's Tested

| Layer | File | What It Pins Down |
|---|---|---|
| Unit | `auth.test.ts` | Cookie parser, security flags, session round-trip |
| Unit | `rbac.test.ts` | Role capability matrix, fail-closed default, wildcard semantics |
| Unit | `policy.test.ts` | Rate limit token bucket, RBAC denial, tenant domain scoping, department scope |
| Unit | `tool-projection.test.ts` | LLM never receives a tool it can't call |
| Unit | `crypto.test.ts` | AES-256-GCM encrypt/decrypt round-trip, HMAC state verify |
| Unit | `byok.test.ts` | BYOK encode/decode, malformed cookie degrades to null |
| Unit | `errors.test.ts` | AppError mapping, ErrorReport persistence, fallback to stderr |
| Unit | `rate-limit.test.ts` | Token bucket, semaphore acquire/release |
| Unit | `invites.test.ts` | Token rotation, expiry, idempotent acceptance |
| Unit | `onboarding.test.ts` | Invite redemption creates correct membership |
| Unit | `qbo-error-classification.test.ts` | QuickBooks API error → user-friendly message |
| Integration | `tenant-isolation.test.ts` | Two tenants in same DB; cross-tenant access returns 404 |
| Integration | `chat-procurement-vs-finance.test.ts` | Procurement user cannot see Finance data at tool-result level |
| Integration | `chat-guard.test.ts` | withGuard enforces auth + CSRF + RBAC on chat routes |
| API | `resources.test.ts` | `/api/resources` through withGuard: 401, 404, 200 contract |
| API | `health.test.ts` | Health endpoint returns correct status |

Each test opens with a "Why this test exists" doc-comment explaining the regression it defends.

### The Core Guarantee

The most important guarantee: **no model output can leak data across departments or tenants, regardless of what the model decides to do.** Validated by three converging tests:

1. `policy.test.ts` — the gate's logic is correct in isolation
2. `tool-projection.test.ts` — the LLM never receives a tool it can't call
3. `chat-procurement-vs-finance.test.ts` — an actual chat turn from a Procurement user against a Finance-only resource returns no data, no error trace, no side-channel

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript 5.5 (strict mode) |
| Database | PostgreSQL 16 via Prisma |
| Auth | NextAuth v5 (Auth.js) — OAuth providers + bridge to app session |
| Session | Cookie-based (`auth_session=userId:tenantId`), httpOnly, sameSite=lax, secure in prod |
| Agent | KindCaddyAgent — OpenAI-compatible, pluggable LLM (OpenRouter / OpenAI / local / BYOK) |
| MCP | In-process tool servers (sqlite, files, calendar, netsuite, quickbooks, square, memory) |
| Rate limiting | Token bucket (per-user) + counting semaphore (global concurrency) |
| Encryption | AES-256-GCM (tokens, BYOK) + HMAC-SHA256 (OAuth state) |
| Error tracking | ErrorReport model with triage workflow (open → acknowledged → resolved) |
| Testing | Jest + ts-jest (unit, integration); Playwright skeleton (e2e); k6 skeleton (load) |
| CI | GitHub Actions |
| Deployment | Docker + Terraform (AWS) |

---

## Integrations

| Integration | Status | Where |
|---|---|---|
| Google Calendar | ✅ Real OAuth + API | `lib/integrations/google-calendar.ts` |
| QuickBooks Online | ✅ Real OAuth + API | `lib/integrations/quickbooks.ts`, `lib/mcp/servers/quickbooks.ts` |
| NetSuite | 🟡 Mocked (schema-shaped) | `lib/mcp/servers/netsuite.ts` |
| Square | 🟡 Mocked (schema-shaped) | `lib/mcp/servers/square.ts` |
| Files | 🟡 In-memory | `lib/mcp/servers/files.ts` |
| SQLite tool | ✅ Real | `lib/mcp/servers/sqlite.ts` |
| Memory | ✅ Real | `lib/mcp/servers/memory.ts` |

Mocked servers expose the same tool schemas they would with a real backend — switching to real APIs is a contained code change inside one file each.

---

## Project Status

**Production-deployed.** The platform is running real workflows at [app.kindcaddy.com](https://app.kindcaddy.com). The architecture, governance patterns, and operational infrastructure are production-grade.

**Known limitations (documented, not hidden):**

- Rate limiter and semaphore are in-process — move to Redis when replicas are introduced
- Audit log is append-only by convention, not tamper-evident at the DB level
- Single-region data residency — multi-region is on the roadmap
- E2E and load tests are skeletons — expand as the system scales

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). PRs welcome; please run `npm test` and `npm run lint` before opening.

## Security

Found a vulnerability? Please read [`SECURITY.md`](./SECURITY.md) for the disclosure process. Do **not** open a public issue for security reports.

## License

MIT — see [`LICENSE`](./LICENSE).
