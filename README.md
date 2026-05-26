# Kindcaddy

> A multi-tenant SaaS reference implementation for an AI assistant that talks to your business systems — with proper RBAC, department-level data scoping, and an auditable tool-use trail.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748.svg)](https://www.prisma.io/)

Kindcaddy is a working demo of how to build an internal AI agent that:

- Is **safe to point at real business data** — every chat turn flows through a cookie-bound auth guard, an RBAC capability check, a rate limiter, and a department-scope filter before any tool is invoked.
- **Doesn't trust the model** — the LLM never sees data the user can't see, never reaches a tool the user can't call, and can't escape the active tenant's MCP domain. Policy is enforced in code, not in the prompt.
- **Audits everything** — every tool call writes a `ToolInvocation` row; every chat turn writes an `AuditEvent`. You can reconstruct any user action from the database alone.

It's intentionally small (~70 TypeScript source files) so the architecture is readable in an afternoon, but the patterns inside (Host orchestrator, MCP framework, policy gate, department-scoped resources, OpenAI-compatible agent bridge) are the same ones you'd ship to production.

---

## Quickstart — zero API keys required

Kindcaddy runs end-to-end against a deterministic mock LLM, so you don't need any provider keys to see it work.

```bash
git clone https://github.com/<your-org>/kindcaddy.git
cd kindcaddy/frontend
cp .env.example .env
npm ci
npm run db:reset          # creates SQLite + seeds demo users, tenants, departments
npm run dev               # http://localhost:3000
```

Sign in at `/login` with:

| Role        | Email                  | Password  |
|-------------|------------------------|-----------|
| Demo user   | `demo@kindai.com`      | `demo123` |

The demo login is gated behind `NODE_ENV !== 'production'` in `app/api/dev/login/route.ts`. It does not ship to prod builds.

### Optional: plug in a real LLM

Set these in `frontend/.env` to route the agent through a real model instead of the mock:

```bash
# Option 1 — Direct OpenAI-compatible endpoint
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# Option 2 — Through Hermes Agent (handles tool-calling loop, multi-provider routing)
HERMES_AGENT_BASE_URL=http://127.0.0.1:8642/v1
HERMES_AGENT_API_KEY=...
HERMES_AGENT_MODEL=hermes-agent
```

Hermes Agent is an external dependency — install it separately from [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3 for how the request flows between Next.js and Hermes.

---

## What's inside

```
kindcaddy/
├── ARCHITECTURE.md       ← Start here. System diagram, request flow, RBAC, data model.
├── DEPLOYMENT.md         ← How to take this from localhost to AWS.
├── TESTING.md            ← Test strategy, current coverage, what each test pins down.
├── OPERATIONS.md         ← SLOs, alerts, runbooks, rollback procedures.
├── SECURITY.md           ← Vulnerability disclosure & threat model.
├── CONTRIBUTING.md       ← How to propose changes.
├── frontend/             ← The Next.js 14 app — UI, API routes, MCP framework, agent bridge.
├── infra/                ← Terraform IaC for AWS — two variants:
│   ├── public-internet/  ←   Vercel + public ALB + Hermes ECS
│   └── private-vpc/      ←   Internal ALB, no public ingress
└── .github/workflows/    ← CI: lint → typecheck → unit → integration, plus
                            CodeQL, gitleaks, dependency-review, Terraform validate.
```

---

## Core ideas worth lifting

If you're here to learn the patterns and apply them to your own system, these are the four things worth taking:

### 1. The policy gate (`lib/mcp/policy.ts`)

Every tool call is wrapped in `evaluatePolicy(ctx, tool, args)` which composes four independent checks:

```text
                ┌──────────────┐
  Tool call ───▶│  RBAC role   │──┐
                └──────────────┘  │
                ┌──────────────┐  │
                │ Rate limit   │──┤
                │ (token       │  │
                │  bucket per  │  ├──▶ allow / deny
                │  user)       │  │
                └──────────────┘  │
                ┌──────────────┐  │
                │ Department   │──┤
                │ scope        │  │
                └──────────────┘  │
                ┌──────────────┐  │
                │ Tenant MCP   │──┘
                │ domain       │
                └──────────────┘
```

The LLM **cannot reach a denied tool** — denied tools are stripped from the catalog before Hermes ever sees them, and even if a tool name is forged, the gate rejects the call at invoke time. There is no "the model promised it wouldn't" handwave.

> **Role system.** Kindcaddy has **two roles**: `admin` and `employee`. `admin` gets the wildcard capability (`*`); `employee` gets `resources:read`. See `lib/rbac.ts` for the canonical map. An earlier four-role design (`viewer` / `editor` / `admin` / `owner`) was collapsed in migration `20260506000000_simplify_roles_and_user_mcp_access` — the two-role model is the system of record. If you're reading old docs that mention `viewer` or `owner`, treat them as historical: `owner` → `admin`, `viewer`/`editor` → `employee`.

### 2. Department-scoped resources

Every `Resource` row has a `departmentId` foreign key. Every Prisma query in `lib/host/*` and `lib/mcp/servers/*` filters by both `tenantId` AND `departmentId` derived from the request context — so the Procurement chat session literally cannot see Finance invoices, even if a model hallucinates an invoice ID. See `ARCHITECTURE.md` §5 (Department Scope & Access Matrix) for the full matrix.

### 3. The MCP domain catalog

Each tenant activates a curated slice of MCP servers (e.g. "finance" enables `quickbooks`, `netsuite`, `sqlite`; "scheduling" enables `calendar`, `files`). The agent only sees the tools its tenant has activated — turning a multi-tenant SaaS into a per-tenant "this assistant only knows about your stack" without forking code.

### 4. Audit-by-construction

`ToolInvocation` is written before the tool runs (status=pending), then updated after (status=ok/error/denied with latencyMs and result). `AuditEvent` is written for every chat turn. You can prove what any user did, in any session, on any day — without log scraping.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript 5.5 (strict mode) |
| Styling | Tailwind CSS 3 |
| Database | SQLite via Prisma (dev) → Postgres (prod) |
| Auth | Cookie-based session (`auth_session=userId:tenantId`), production replacement documented in [`DEPLOYMENT.md`](./DEPLOYMENT.md) §3 |
| Agent | OpenAI tool-calling shape; pluggable LLM (OpenAI / Hermes / Mock) |
| Testing | Jest + ts-jest (unit, integration); Playwright skeleton (e2e); k6 skeleton (load) |
| CI | GitHub Actions |

---

## Project status

This is a **demonstration / reference implementation**, not a SaaS product you can buy today. The architecture and patterns are production-grade; the operational footprint (managed hosting, SOC 2 controls, paid SLA) is not yet built. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the work required to take this to a paying customer, and [`OPERATIONS.md`](./OPERATIONS.md) for the runtime contract.

**Mocked vs real integrations:**

| Integration | Status | Where |
|---|---|---|
| Google Calendar | ✅ Real OAuth + API | `lib/integrations/google-calendar.ts` |
| QuickBooks Online | ✅ Real OAuth + API | `lib/integrations/quickbooks.ts`, `lib/mcp/servers/quickbooks.ts` |
| NetSuite | 🟡 Mocked (schema-shaped) | `lib/mcp/servers/netsuite.ts` |
| Square | 🟡 Mocked (schema-shaped) | `lib/mcp/servers/square.ts` |
| Files | 🟡 In-memory | `lib/mcp/servers/files.ts` |
| SQLite tool | ✅ Real | `lib/mcp/servers/sqlite.ts` |

The mocked servers expose the same tool schemas they would with a real backend — so switching them to real APIs is a contained code change inside one file each. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) §6 for the per-vendor wiring checklist.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). PRs welcome; please run `npm test` and `npm run lint` before opening.

## Security

Found a vulnerability? Please read [`SECURITY.md`](./SECURITY.md) for the disclosure process. Do **not** open a public issue for security reports.

## License

MIT — see [`LICENSE`](./LICENSE).
