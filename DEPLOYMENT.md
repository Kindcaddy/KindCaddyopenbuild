# Deployment

How Kindcaddy goes from `localhost:3000` to a production environment on AWS, what changes between the demo and a real deployment, and what each environment looks like.

This document is **the architecture of the deployment**, not a step-by-step internal runbook. The diagrams and choices below are designed to be reviewed, critiqued, and adapted to your organization's standards.

> **Executable form:** The topology described below is committed as Terraform under [`infra/`](./infra/), in two variants:
> - [`infra/public-internet/`](./infra/public-internet/) — Vercel-hosted Next.js + ECS Fargate Hermes behind a public ALB + WAF. Fastest to ship.
> - [`infra/private-vpc/`](./infra/private-vpc/) — Both Next.js and Hermes on ECS behind an internal ALB. No public ingress; reached via VPN, Direct Connect, or a peered VPC.
>
> Each variant accepts a `*.tfvars` file so the same modules deploy `staging` and `prod` with different sizes, single-AZ vs multi-AZ, etc. See [`infra/README.md`](./infra/README.md) for the side-by-side decision table.

---

## 1. Environment topology

Three environments, identical shape, different scale and isolation.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│   Local (dev)            Staging                  Production              │
│   ────────────           ────────                 ──────────              │
│   SQLite file            RDS Postgres             RDS Postgres            │
│   MockLLMProvider        Single-AZ                Multi-AZ                │
│   Hermes optional        Hermes ECS Fargate       Hermes ECS Fargate      │
│                          1 task, 0.5 vCPU         3+ tasks, 1 vCPU each   │
│                          Vercel Preview           Vercel Prod / Amplify   │
│                          *.staging.kindcaddy.ai   app.kindcaddy.ai        │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

The contract is: **anything that works in staging works in prod, and anything that works in prod can be reproduced in staging.** Local is allowed to diverge (SQLite, mock LLM) because the goal of local is fast iteration, not production fidelity.

---

## 2. Production AWS topology

```
                              ┌─────────────────┐
                              │   Route 53      │
                              │  kindcaddy.ai   │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │   CloudFront    │
                              │   + ACM cert    │
                              └────────┬────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                │                                             │
                ▼                                             ▼
       ┌────────────────┐                           ┌──────────────────┐
       │   Vercel       │                           │   S3 (static     │
       │  (Next.js app) │                           │   marketing)     │
       │  app.kindcaddy │                           └──────────────────┘
       │      .ai       │
       └───────┬────────┘
               │ HTTPS w/ IAM-signed JWT
               │
   ┌───────────┴──────────────────────────────────────────────┐
   │                     AWS account / VPC                    │
   │                                                          │
   │   ┌──────────────────────────────────────────────────┐   │
   │   │              Private subnets                     │   │
   │   │                                                  │   │
   │   │   ┌─────────────────┐   ┌────────────────────┐  │   │
   │   │   │  Hermes Agent   │   │   RDS Postgres 16  │  │   │
   │   │   │  ECS Fargate    │──▶│   Multi-AZ         │  │   │
   │   │   │  3+ tasks       │   │   Encrypted (KMS)  │  │   │
   │   │   │  agent-sg       │   │   db-sg            │  │   │
   │   │   └────────┬────────┘   └────────────────────┘  │   │
   │   │            │                                     │   │
   │   │            │ outbound HTTPS                      │   │
   │   │            ▼                                     │   │
   │   │   ┌──────────────────┐                          │   │
   │   │   │   NAT Gateway    │                          │   │
   │   │   └────────┬─────────┘                          │   │
   │   └────────────┼───────────────────────────────────┘   │
   │                │                                        │
   └────────────────┼────────────────────────────────────────┘
                    │
                    ▼
       ┌──────────────────────────────────────────────────┐
       │  External SaaS (egress only)                     │
       │  OpenRouter / Anthropic / OpenAI                 │
       │  Google APIs / QuickBooks / NetSuite / Square    │
       └──────────────────────────────────────────────────┘
```

### Service choices and why

| Concern | Service | Rationale |
|---|---|---|
| Frontend host | **Vercel** | Zero-ops Next.js hosting; preview deploys per PR; automatic CDN. Trade-off: leaves VPC, must reach Hermes over the public internet with a signed token. For VPC-only setups, swap to AWS Amplify or ECS Fargate behind an ALB. |
| Agent host | **ECS Fargate** | Stateless, scales horizontally, no public IP. Easier to operate than EKS for a 1-service deployment; easier to scale than Lambda for a long-running tool loop. |
| Database | **RDS Postgres 16, Multi-AZ** | Drop SQLite. Multi-AZ for prod, Single-AZ for staging to halve cost. Encryption at rest with customer-managed KMS key. |
| Secrets | **AWS Secrets Manager** | Rotation built-in; per-env scoping; consumed by ECS task role (no static credentials). Vercel pulls via the [Secrets Manager integration](https://vercel.com/integrations/aws-secrets-manager) or env-var sync from a CI step. |
| Token encryption at rest | **KMS-wrapped envelope (AES-256-GCM)** | OAuth refresh tokens stored on `Resource.data` are envelope-encrypted in the app layer (see `lib/crypto.ts`). DEK is generated per row and wrapped by a customer-managed KMS CMK; ENC_PROVIDER=`aws-kms` selects the production path, `local` (with `APP_ENC_KEY`) is the dev path. RDS at-rest encryption uses the same CMK. |
| CDN / TLS | **CloudFront + ACM** | Standard. ACM cert in `us-east-1` for CloudFront, in the primary region for ALB. |
| Logs | **CloudWatch Logs** | Aggregated from Vercel via the Log Drain integration; from Hermes via the awslogs driver. Optional shipping to Datadog / Grafana Cloud via subscription filter. |
| Errors | **Sentry** | Separate projects for `kindcaddy-frontend` and `kindcaddy-hermes`. Source maps uploaded by the build step. |
| Metrics | **CloudWatch + Sentry Performance** | Pull `ToolInvocation` success rate and chat-turn latency directly from the DB into a CloudWatch custom metric (1-min cron). |
| DNS | **Route 53** | Apex (`kindcaddy.ai`), `app.`, `staging.`, internal `hermes.internal.` |
| Backups | **RDS automated + weekly logical dump to S3** | 7-day automated retention; weekly `pg_dump` for long-term cold storage; encrypted with SSE-KMS. |
| CI/CD | **GitHub Actions → OIDC → AWS** | No static AWS keys in GitHub. The CI workflow assumes a role per environment via OIDC. |

---

## 3. Auth — production replacement

The demo `auth_session=userId:tenantId` cookie is a developer affordance. Three things change for production:

1. **Identity provider.** The cookie value must come from a real auth provider, not the dev login. Recommended path:
   - **Option A (fastest):** Auth.js (NextAuth) with Email magic-link + Google + GitHub providers.
   - **Option B:** AWS Cognito User Pool + Hosted UI (good if you're already AWS-native).
   - **Option C:** Clerk / WorkOS for B2B SSO (good if customers demand SAML).
2. **Cookie hardening.** `secure: true`, `sameSite: 'strict'`, signed JWT instead of plaintext (current code already branches on `NODE_ENV === 'production'`).
3. **Dev routes off in prod.** `/api/dev/login`, `/api/dev/whoami`, `/api/dev/users` must 404 when `NODE_ENV === 'production'`. This is a single guard at the top of each handler.

The contract `withGuard` consumes — `RequestContext { userId, tenantId, role, departmentId }` — does not change. Everything downstream of the guard is identity-provider-agnostic.

---

## 4. Database migration: SQLite → Postgres

Current `frontend/prisma/schema.prisma` uses `provider = "sqlite"`. For production:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

| Concern | Action |
|---|---|
| Schema differences | `String @id @default(cuid())` works identically. JSON columns are stored as `Json` in Postgres (typed) vs `String` in SQLite (manual parse). The `lib/host/session.ts` `memory` field is the only column that benefits — switch its type from `String` to `Json` at migration time. |
| Migrations | `npx prisma migrate dev` locally → commit migration → `npx prisma migrate deploy` in CI before the new app version starts. Migrations must be forward-compatible with the previous deployed version (zero-downtime). |
| Seed | `prisma/seed.ts` is environment-agnostic; runs against staging on first deploy, never against prod. |
| Connection pooling | Prisma Data Proxy or PgBouncer (transaction mode) sit between Vercel functions and RDS to avoid connection exhaustion. |

---

## 5. The change-promotion workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   Developer                                                             │
│       │                                                                 │
│       │ git push origin feature/x                                       │
│       ▼                                                                 │
│   ┌─────────────────────────────────────┐                              │
│   │  GitHub: PR opened                  │                              │
│   │                                     │                              │
│   │  CI gates (must pass):              │                              │
│   │  ├─ lint                            │                              │
│   │  ├─ typecheck (tsc --noEmit)        │                              │
│   │  ├─ unit + integration (jest)       │                              │
│   │  ├─ secret scan (gitleaks)          │                              │
│   │  └─ dep audit (npm audit)           │                              │
│   │                                     │                              │
│   │  Vercel: preview deploy             │                              │
│   │  (ephemeral URL per PR)             │                              │
│   └────────────────┬────────────────────┘                              │
│                    │ reviewer approves                                  │
│                    ▼                                                    │
│   ┌─────────────────────────────────────┐                              │
│   │  Merge to main                      │                              │
│   │  ├─ Vercel: deploy to staging       │                              │
│   │  ├─ ECS: rolling update Hermes      │                              │
│   │  └─ RDS: prisma migrate deploy      │                              │
│   └────────────────┬────────────────────┘                              │
│                    │                                                    │
│                    ▼                                                    │
│   ┌─────────────────────────────────────┐                              │
│   │  Staging post-deploy                │                              │
│   │  ├─ smoke tests (curl)              │                              │
│   │  ├─ e2e (Playwright @smoke)         │                              │
│   │  └─ Slack notification              │                              │
│   └────────────────┬────────────────────┘                              │
│                    │ manual sign-off                                    │
│                    │ (GitHub deployment env approval)                   │
│                    ▼                                                    │
│   ┌─────────────────────────────────────┐                              │
│   │  Production canary (5% for 10 min)  │                              │
│   │  ├─ auto-promote if SLOs hold       │                              │
│   │  └─ auto-rollback on SLO breach     │                              │
│   └────────────────┬────────────────────┘                              │
│                    ▼                                                    │
│   ┌─────────────────────────────────────┐                              │
│   │  Production 100%                    │                              │
│   │  └─ post-deploy smoke + change log  │                              │
│   └─────────────────────────────────────┘                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

Key invariants:

- **No secrets in GitHub Actions.** OIDC trust to an AWS role; the role has env-scoped permissions.
- **Migrations run before the new app starts.** If a migration fails, the new deploy is aborted; the old app keeps serving on the old schema.
- **Rollback is faster than forward-fix.** If SLOs break post-deploy, the canary auto-rolls back before a human is paged.

---

## 6. Replacing mocked integrations with real ones

Every mocked MCP server (`quickbooks`, `netsuite`, `square`, `files`) is a single file with a clear seam. Replacing one follows the same four steps as Google Calendar:

1. **OAuth or API-key flow.** Add start/callback routes at `frontend/app/api/integrations/<vendor>/{start,callback}/route.ts` using `lib/integrations/google-calendar.ts` as a template.
2. **Integration helper.** Add `lib/integrations/<vendor>.ts` that owns token storage (encrypted, in the `Resource` table under a `name = "<vendor>_connection"` row).
3. **Replace the mock body.** In `lib/mcp/servers/<vendor>.ts`, swap the in-memory state for real API calls via the integration helper.
4. **Activate per tenant.** Insert a `TenantMcpDomain` row, or surface it via `/admin`.

| Vendor | Auth | Per-tenant or per-app | Status |
|---|---|---|---|
| QuickBooks Online | OAuth 2.0 | App-level client; per-tenant tokens | ✅ **Real.** `lib/integrations/quickbooks.ts` + `app/api/integrations/quickbooks/{start,callback}/route.ts` + `lib/mcp/servers/quickbooks.ts`. Tokens stored envelope-encrypted. |
| NetSuite | OAuth 1.0a TBA | Per-tenant (account-specific) | Mocked. ~2 days. |
| Square | OAuth 2.0 | App-level client; per-tenant tokens | Mocked. ~1 day. |
| Apple iCloud Calendar | CalDAV + app-specific password | Per-user | Mocked. ~1 day. |
| S3 (for `files` server) | IAM role | App-level | Mocked. ~half-day. |

Once each integration is real, no other layer of the stack needs to change. The policy gate, audit log, rate limiter, and department scope all see the same tool surface they saw with the mock.

---

## 7. Cost envelope (rough, US-East-1, monthly)

This is a sketch of what production scale looks like — not a quote.

| Item | Staging | Prod (low traffic) | Prod (1k DAU) |
|---|---|---|---|
| Vercel | Free tier | $20 Pro | $20–$150 |
| RDS Postgres | `db.t4g.small` Single-AZ | `db.t4g.small` Multi-AZ | `db.t4g.medium` Multi-AZ |
| | ~$15 | ~$60 | ~$120 |
| ECS Fargate (Hermes) | 1 task × 0.5 vCPU / 1 GB | 2 tasks × 1 vCPU / 2 GB | 4 tasks × 1 vCPU / 2 GB |
| | ~$10 | ~$60 | ~$120 |
| NAT Gateway | $32 + traffic | $32 + traffic | $32 + traffic |
| Secrets Manager | <$5 | <$5 | <$5 |
| CloudWatch + Sentry | Free tiers | ~$20 | ~$80 |
| LLM (OpenRouter, avg 1k tokens/turn) | $0 (mock) | metered | ~$100–$500 |
| **Approx total** | **~$60/mo** | **~$200/mo + LLM** | **~$500/mo + LLM** |

The dominant variable cost is LLM usage. Everything else is roughly fixed.

---

## 8. Out of scope for this document

These are documented elsewhere or deliberately omitted to keep this doc reviewable:

- Per-vendor OAuth consent screens, scopes, and verification flows → owner: integration engineer.
- SOC 2 / GDPR controls → owner: compliance, see `SECURITY.md` for the security posture summary.
- Cost optimization beyond the envelope above → owner: ops, after first paying customer.
- Customer onboarding flow (who creates a `Tenant`, how invites work) → product decision, see `ARCHITECTURE.md` §4.

---

## Summary

> A Next.js app on Vercel calls a Hermes agent on ECS Fargate in a private subnet, which calls RDS Postgres for state and the public internet for LLMs and SaaS integrations. Every secret is in AWS Secrets Manager. Every deploy goes through CI gates → staging → canary → prod with auto-rollback. Every integration that's mocked today has a one-file replacement path. SQLite is the demo's compromise, not the production design.
