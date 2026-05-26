# Kindcaddy — Frontend (Next.js 14)

The web app: UI, API routes, MCP framework, agent bridge, RBAC, and audit. All of Kindcaddy's runtime logic lives here.

For the project overview, see the [top-level README](../README.md). For the architecture, see [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Quickstart

```bash
cp .env.example .env
npm ci
npm run db:reset    # creates SQLite + seeds demo users/tenants/departments
npm run dev         # http://localhost:3000
```

Demo login: `demo@kindai.com` / `demo123` (dev-only, gated by `NODE_ENV`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Next.js dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm test` | Run unit + integration tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run db:migrate` | Apply pending Prisma migrations |
| `npm run db:seed` | Seed the database from `prisma/seed.ts` |
| `npm run db:reset` | Drop, migrate, and re-seed (dev only — destructive) |
| `npm run lint` | ESLint |

## Project structure

```
frontend/
├── app/                          Next.js App Router
│   ├── api/                      API route handlers
│   │   ├── me/                   Current user / context
│   │   ├── mcp/                  Chat, tools, sessions, audit, domains
│   │   ├── integrations/         OAuth flows (Google today)
│   │   ├── admin/                Tenant/user admin
│   │   ├── resources/            Resource CRUD
│   │   └── dev/                  Dev-only login/logout/whoami (gated by NODE_ENV)
│   ├── app/                      Authenticated user surface (/app/*)
│   ├── admin/                    Admin surface (/admin/*)
│   ├── login/                    Public login page
│   ├── dashboard/                Legacy dashboard
│   ├── layout.tsx, page.tsx      Root layout + landing
│   └── globals.css
│
├── lib/                          Runtime logic
│   ├── auth.ts                   Cookie parser + setter
│   ├── guard.ts                  withGuard wrapper for API routes
│   ├── rbac.ts                   Role → capability matrix
│   ├── context.ts                RequestContext type
│   ├── db.ts                     Singleton Prisma client
│   ├── host/                     Chat orchestration (host, session manager)
│   ├── agents/                   Agent bridge (Hermes external, base interface)
│   ├── llm/                      LLM adapters (openai, mock, factory)
│   ├── mcp/                      MCP framework (client, registry, policy, protocol,
│   │                             normalize, domain catalog, domain settings, servers/)
│   └── integrations/             External SaaS clients (google-calendar.ts)
│
├── components/                   React components
│   ├── ui/                       Reusable primitives (Button, Card, etc.)
│   └── UserProfileDropdown.tsx
│
├── prisma/
│   ├── schema.prisma             Data model (User, Tenant, Department, Membership,
│   │                             Resource, ChatSession, ChatMessage, ToolInvocation,
│   │                             AuditEvent, TenantMcpDomain)
│   ├── migrations/
│   └── seed.ts                   Deterministic demo data
│
└── __tests__/                    Test suite — see ../TESTING.md
    ├── lib/                      Unit tests
    ├── integration/              Cross-layer tests with real DB
    └── api/                      API route tests
```

## Two user surfaces

### `/app/*` — authenticated user

| Route | Purpose |
|---|---|
| `/app` | User dashboard |
| `/app/assistant` | The chat surface; primary product entry point |
| `/app/profile` | Profile + identity |
| `/app/configuration` | Per-user integration setup (Google Calendar, etc.) |
| `/app/access-control` | Role-aware view of what the user can access |
| `/app/system-settings` | Personal preferences |

### `/admin/*` — admin only (RBAC: `admin` role required)

| Route | Purpose |
|---|---|
| `/admin` | Admin dashboard |
| `/admin/users` | User and membership management |

## Env vars

See `.env.example` for the full list. Key ones:

| Var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Prisma connection string | `file:./dev.db` |
| `HERMES_AGENT_BASE_URL` | Hermes agent endpoint | `http://127.0.0.1:8642/v1` |
| `HERMES_AGENT_API_KEY` | Bearer for Hermes | `change-me-local-dev` |
| `HERMES_AGENT_MODEL` | Model name passed to Hermes | `hermes-agent` |
| `OPENAI_API_KEY` | Direct OpenAI fallback (optional) | unset → mock LLM |
| `GOOGLE_CLIENT_ID` / `SECRET` | Google OAuth credentials | unset → integration disabled |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback | `http://localhost:3000/api/integrations/google/callback` |

Without `OPENAI_API_KEY` and without a reachable Hermes service, the app falls back to `MockLLMProvider` — fully functional, deterministic, no external calls.

## Tech

- **Next.js 14** App Router with React Server Components
- **TypeScript 5.5** strict mode
- **Prisma 7** with SQLite (dev) — switchable to Postgres for prod (one-line schema change)
- **Tailwind CSS 3** with dark mode
- **Lucide React** for icons
- **Jest 30** + **ts-jest** + **@testing-library/react** for tests
- **better-sqlite3** as the Prisma SQLite driver
- **googleapis** for Google Calendar OAuth + API

## Related docs

| | |
|---|---|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | System diagram, request flow, RBAC matrix, data model |
| [`../DEPLOYMENT.md`](../DEPLOYMENT.md) | Local → AWS production path |
| [`../TESTING.md`](../TESTING.md) | Test pyramid, current coverage, threat-per-test |
| [`../OPERATIONS.md`](../OPERATIONS.md) | SLOs, alerts, runbooks |
| [`./SECURITY_HEADERS.md`](./SECURITY_HEADERS.md) | HTTP security header configuration (from `next.config.js`) |
| [`./lib/mcp/README.md`](./lib/mcp/README.md) | MCP framework internals |
