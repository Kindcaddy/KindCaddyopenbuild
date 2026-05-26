# Kindcaddy Web App — System Diagram & Workflow

This document describes the architecture and runtime workflow of the Kindcaddy web app
(**KindCaddy**). It is split into:

1. High-level system diagram
2. Component layers and responsibilities
3. End-to-end request workflow (chat with tools)
4. Authentication / session workflow
5. Department scope & access matrix
6. Policy gate — implementation reference
7. Third-party integration workflow (Google OAuth example)
8. Data model
9. Deployment topology

All diagrams are plain ASCII so they render the same everywhere, including in terminals
and plain-text viewers — no Mermaid or other diagram renderer required.

---

## 1. High-Level System Diagram

```text
+---------------------------------------------------------------+
|             Browser (End User / Admin)                        |
|                                                               |
|   [Marketing site]   [Customer UI]   [Admin UI]   [Login]     |
|   (website/*.html)      /app/*         /admin/*   /signup     |
+--------|------------------|---------------|----------|--------+
         |                  |               |          |
         | static HTML      v               v          v
         v              +-----------------------------------+
     (browser           |  Next.js 14 App Router pages      |
      only)             |  (React Server Components)        |
                        +-----------------+-----------------+
                                          |
                                          v
                        +-----------------------------------+
                        |  API routes                       |
                        |  /api/me  /api/mcp/*              |
                        |  /api/integrations/*  /api/dev/*  |
                        +-----------------+-----------------+
                                          |
                                          v
                        +-----------------------------------+
                        |  Auth guard + RBAC                |
                        |  lib/auth.ts  lib/guard.ts        |
                        |  lib/rbac.ts                      |
                        +----+--------------+---------------+
                             |              |
                             v              v
              +-----------------------+   +----------------------+
              | Host orchestrator     |   | Session manager      |
              | lib/host/host.ts      |<->| lib/host/session.ts  |
              +----+-------------+----+   +----------+-----------+
                   |             |                   |
                   v             v                   |
       +-----------------+  +----------------+       |
       | Agent runtime   |  | MCP framework  |       |
       | lib/agents/     |  | lib/mcp/       |       |
       | hermes.ts       |  | {client,       |       |
       |                 |  |  registry,     |       |
       |                 |  |  policy,       |       |
       |                 |  |  protocol}     |       |
       +--------+--------+  +-------+--------+       |
                |                   |                |
           HTTP |                   v                |
                |        +-----------------------+   |
                |        | MCP tool servers      |   |
                |        | sqlite, files,        |   |
                |        | calendar, netsuite,   |   |
                |        | quickbooks, square    |   |
                |        +-----+-----------+-----+   |
                |              |           |         |
                |              v           | mocked  |
                |   +-------------------+  | today   |
                |   | External          |  |         |
                |   | integrations      |  |         |
                |   | google-calendar.ts|  |         |
                |   +---------+---------+  |         |
                |             |            |         |
                v             v            v         v
       +-----------+   +-----------+  +-----------+  +------------+
       |  Hermes   |   |  Google   |  | Business  |  | SQLite via |
       |  Agent    |   |  APIs     |  | systems   |  | Prisma     |
       | (Python,  |   | (Calendar |  | (NetSuite,|  | dev.db /   |
       |  port     |   |  OAuth)   |  | QuickBooks|  | test.db)   |
       |  8642)    |   |           |  | , Square) |  |            |
       +-----------+   +-----------+  +-----------+  +------------+
```

Legend:
- Solid arrows = runtime call path
- `mocked today` = MCP server has the tool surface but talks to a stub, not the real system
- The DB is reached from the Host orchestrator, Session manager, and Auth guard

---

## 2. Component Layers

| Layer | Path | Responsibility |
|---|---|---|
| **Marketing site** | `website/` | Static HTML (index, mission, services, products, contact, legal). Pure SEO/landing surface, no app coupling. |
| **Web app (Next.js 14)** | `Kindcaddywebapp/frontend/` | The product. App Router pages + API routes + agent/MCP plumbing. |
| **Auth & RBAC** | `lib/auth.ts`, `lib/guard.ts`, `lib/rbac.ts` | Cookie-based sessions (`auth_session=userId:tenantId`), per-route guard, role check (`admin` / `employee` — see §6.1 for the capability map). |
| **Host orchestrator** | `lib/host/host.ts` | Owns the chat surface: resolves sessions, persists messages, picks an active MCP domain, invokes the agent, writes audit events. |
| **Session manager** | `lib/host/session.ts` | CRUD for `ChatSession`, `ChatMessage`, working `memory` JSON. |
| **Agent runtime** | `lib/agents/hermes.ts` | `ExternalHermesAgent` calls the Hermes Python service over HTTP using the OpenAI tool-calling shape and bridges tool calls back to the local MCP client. |
| **LLM adapters** | `lib/llm/{openai,mock}.ts` | Pluggable LLM clients (Hermes is the primary runtime; OpenAI and a deterministic mock exist for dev/test). |
| **MCP framework** | `lib/mcp/{client,registry,policy,protocol,normalize,domain-catalog,domain-settings}.ts` | Registers tool servers, evaluates policy (RBAC + token-bucket rate limit), invokes tools, normalizes results, scopes tools by **chat domain** (a tenant-active slice of MCP servers). |
| **MCP tool servers** | `lib/mcp/servers/*.ts` | In-process implementations: `sqlite`, `files`, `calendar`, `netsuite`, `quickbooks`, `square`. Mocked but tool/schema-shaped. |
| **External integrations** | `lib/integrations/google-calendar.ts` | Real Google OAuth + Calendar API; the `calendar` MCP server delegates to it. |
| **Persistence** | `prisma/schema.prisma` + `dev.db` | SQLite via Prisma. Multi-tenant: `User`, `Tenant`, `Department`, `Membership`, `Resource`, `AuditEvent`, `ChatSession`, `ChatMessage`, `ToolInvocation`, `TenantMcpDomain`. |
| **Hermes Agent** | `Kindcaddywebapp/hermes-agent/` | Independent Python service exposing an OpenAI-compatible `/v1/chat/completions` endpoint. The web app talks to it via `HERMES_AGENT_BASE_URL` (default `http://127.0.0.1:8642/v1`). |

---

## 3. End-to-End Workflow — Chat Turn With Tool Use

This is the core flow when a user sends a message in the in-app assistant.

```text
Participants:
  U    = User (browser)
  Page = /app/assistant page
  API  = POST /api/mcp/chat
  G    = withGuard (auth + RBAC)
  H    = Host.chat()
  SM   = SessionManager
  DB   = Prisma / SQLite
  A    = ExternalHermesAgent
  Herm = Hermes Agent (Python)
  MC   = MCP Client + Policy
  TS   = MCP Tool Server (e.g. quickbooks / files)
  Ext  = External API (e.g. Google Calendar)

  U     Page   API    G     H     SM    DB    A    Herm   MC    TS    Ext
  |      |      |     |     |     |     |     |     |     |     |     |
 1| type |      |     |     |     |     |     |     |     |     |     |
  |----->|      |     |     |     |     |     |     |     |     |     |
 2|      | POST { sessionId?, message, domain? }                       |
  |      |----->|     |     |     |     |     |     |     |     |     |
 3|      |      | validate auth_session cookie                         |
  |      |      |---->|     |     |     |     |     |     |     |     |
 4|      |      |     | load User + Membership + role                  |
  |      |      |     |---------->|     |     |     |     |     |     |
 5|      |      |<----| RequestContext { userId, tenantId, role }      |
  |      |      |     |     |     |     |     |     |     |     |     |
 6|      |      | host.chat(ctx, req)                                  |
  |      |      |---------->|     |     |     |     |     |     |     |
  |      |      |     |     |     |     |     |     |     |     |     |
  |      |      |     |     |--- session setup ----|     |     |     |
 7|      |      |     |     | getOwned(sessionId) or create()          |
  |      |      |     |     |---->|     |     |     |     |     |     |
 8|      |      |     |     |     | read/insert ChatSession            |
  |      |      |     |     |     |---->|     |     |     |     |     |
 9|      |      |     |     | createMessage(role=user)                 |
  |      |      |     |     |---->|     |     |     |     |     |     |
10|      |      |     |     |     | insert ChatMessage                 |
  |      |      |     |     |     |---->|     |     |     |     |     |
11|      |      |     |     | load active TenantMcpDomain              |
  |      |      |     |     |---------->|     |     |     |     |     |
12|      |      |     |     | loadHistoryAsTurns(sessionId)            |
  |      |      |     |     |---->|     |     |     |     |     |     |
13|      |      |     |     | createMessage(role=assistant, pending)   |
  |      |      |     |     |---->|     |     |     |     |     |     |
  |      |      |     |     |     |     |     |     |     |     |     |
14|      |      |     |     | agent.step({ ctx, history, allowedTools })
  |      |      |     |     |---------------->|     |     |     |     |
  |      |      |     |     |     |     |     |     |     |     |     |
  |      |      |     |     | LOOP: up to maxRounds                   |
  |      |      |     |     |     |     |     |     |     |     |     |
15|      |      |     |     |     |     |     | POST /v1/chat/completions
  |      |      |     |     |     |     |     |---->|     |     |     |
  |      |      |     |     |     |     |     |     (messages + tools = MCP catalog)
16|      |      |     |     |     |     |     |<----| assistant msg ± tool_calls
  |      |      |     |     |     |     |     |     |     |     |     |
  |      |      |     |     |  IF tool_calls present:                 |
  |      |      |     |     |    LOOP each tool call:                 |
17|      |      |     |     |     |     |     | client.invoke(tool, args, ctx, ids)
  |      |      |     |     |     |     |     |---------->|     |     |
18|      |      |     |     |     |     |     |     | evaluatePolicy (role + rate limit)
  |      |      |     |     |     |     |     |     |     |--+  |     |
  |      |      |     |     |     |     |     |     |     |<-+  |     |
  |      |      |     |     |       IF policy allows:              |
19|      |      |     |     |     |     |     |     |     | server.invoke(tool, args)
  |      |      |     |     |     |     |     |     |     |---->|     |
20|      |      |     |     |     |     |     |     |     |     | optional outbound
  |      |      |     |     |     |     |     |     |     |     |---->|
21|      |      |     |     |     |     |     |     |     |     |<----| response
22|      |      |     |     |     |     |     |     |     |<----| normalized result
  |      |      |     |     |       ELSE policy denies:            |
23|      |      |     |     |     |     |     |<----------| { ok:false, error:"denied" }
24|      |      |     |     |     |     |     | insert ToolInvocation (params, result, latency, status)
  |      |      |     |     |     |     |     |     |---------->|     |
  |      |      |     |     |     |     |     |        (write via MC -> DB)
25|      |      |     |     |     |     |     | append tool turn to history (A self)
  |      |      |     |     |     |     |     |--+  |     |     |     |
  |      |      |     |     |     |     |     |<-+  |     |     |     |
  |      |      |     |     |  ELSE no tool calls: Hermes produced final reply
  |      |      |     |     |  END LOOP                              |
  |      |      |     |     |     |     |     |     |     |     |     |
26|      |      |     |     |<----------------| { finalContent, turns }|
27|      |      |     |     | updateMessage(assistant, content + trace)|
  |      |      |     |     |---->|     |     |     |     |     |     |
28|      |      |     |     | touch session, updateMemory             |
  |      |      |     |     |---->|     |     |     |     |     |     |
29|      |      |     |     | insert AuditEvent (mcp.chat.turn)       |
  |      |      |     |     |---------->|     |     |     |     |     |
  |      |      |     |     |     |     |     |     |     |     |     |
30|      |      |<----| ChatResponse { sessionId, reply, trace }       |
  |      |      |     |     |     |     |     |     |     |     |     |
31|      |<-----| JSON|     |     |     |     |     |     |     |     |
  |      |      |     |     |     |     |     |     |     |     |     |
32|<-----| render reply + tool trace                                  |
  |      |      |     |     |     |     |     |     |     |     |     |
  v      v      v     v     v     v     v     v     v     v     v     v
```

Notes:
- Arrows: `--->` request/call, `<---` response/return.
- `--+` / `<-+` denotes a self-call (the participant calling a method on itself).
- The "LOOP up to maxRounds" wraps steps 15–25; one iteration ends either with a final reply (no tool calls) or after processing all tool calls in this round.

### Key invariants enforced in this flow

- **Tenant isolation** — every DB query through `SessionManager` and `Host` filters by `ctx.tenantId`; cross-tenant access is impossible without forging the cookie.
- **Domain scoping** — only tools whose server is in the active `TenantMcpDomain` are exposed to Hermes. Hermes literally cannot call a tool the tenant hasn't activated.
- **RBAC capability check** — each `RegisteredTool` declares a capability (`read` / `write` / `admin`); `evaluatePolicy` rejects calls below the user's role.
- **Rate limiting** — token-bucket per `(tenantId, userId)` (30 burst, 1 rps) inside `lib/mcp/policy.ts`.
- **Auditability** — every tool call writes a `ToolInvocation`; every chat turn writes an `AuditEvent`.

---

## 4. Authentication & Session Workflow

```text
Participants:
  U      = User
  L      = /login page
  API    = POST /api/dev/login (or real auth)
  DB     = Prisma
  Cookie = auth_session cookie
  App    = Any /app or /api route
  G      = withGuard

  U      L     API    DB   Cookie  App    G
  |      |      |     |     |      |     |
  |--- LOGIN ---|     |     |      |     |
 1| submit email|     |     |      |     |
  |----->|      |     |     |      |     |
 2|      | POST { email }    |     |      |     |
  |      |----->|     |     |      |     |
 3|      |      | upsert User, default Membership (tenant + dept + role)
  |      |      |---->|     |      |     |
 4|      |      | set auth_session = userId:tenantId (httpOnly, sameSite=lax, 7d)
  |      |      |---------->|      |     |
 5|      |<-----| 200 OK    |      |     |
 6|<-----| redirect to /app |      |     |
  |      |      |     |     |      |     |
  |--- ACCESS PROTECTED ROUTE ---  |     |
 7| navigate /app/assistant         |     |
  |---------------------------->|         |
 8|      |      |     |     |      | read cookie via getAuthCookie()
  |      |      |     |     |      |---->|
 9|      |      |     | load User + active Membership for tenantId
  |      |      |     |<----------------|
  |      |      |     |     |      |     |
  |   IF membership found:           |
10|      |      |     |     |      |<----| ctx { userId, tenantId, role, departmentId }
11|<-----------------------------------| render protected page
  |   ELSE missing / invalid:        |
12|<-----------------------------------| 401 / redirect /login
  |      |      |     |     |      |     |
  |--- LOGOUT ---|     |     |      |     |
13| POST /api/logout                  |     |
  |---------------------------->|         |
14|      |      |     |     |<-----| clearAuthCookie()
15|<-----------------------------------| redirect /login
  |      |      |     |     |      |     |
  v      v      v     v     v      v     v
```

The same `withGuard` wrapper protects every `/api/mcp/*`, `/api/me`, `/api/resources`,
and `/api/integrations/*` route, so the chat workflow above always starts from a
verified `RequestContext`.

---

## 5. Department Scope & Access Matrix

Every MCP tool declares a **data scope** (`DataScope` in
`lib/mcp/protocol.ts`) that the policy gate evaluates *in addition to* the
role-based capability check (`read` / `write` / `admin`). Role answers
"what verbs can you do?"; department scope answers "whose data can you
touch?".

### The matrix

| `DataScope` value           | Who is allowed to invoke the tool                                              | Typical use                                              |
|-----------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------|
| `'public'` (or missing)     | Any member of the tenant.                                                      | Tenant-wide reference data, catalogs, search.            |
| `'own_department'`          | Caller whose `Membership.departmentId` matches the tool's owning department.   | Per-department resources (a Finance-only ledger view).   |
| `{ department: 'finance' }` | Caller whose membership department **name** matches under normalization.       | A tool hard-wired to one department.                     |
| `'tenant_admin'`            | Caller with **company-wide clearance** (see below).                            | Cross-department reports, admin-only writes.             |

A `undefined` scope is treated as `'public'` so adding the field to an
existing tool is a non-breaking change. The union is a discriminated type
on purpose — the compiler forces the policy gate to handle every variant,
so "oops, I forgot `tenant_admin`" can't ship.

### Department-name normalization — one rule, one place

Both `{ department: '…' }` matching and the Executive-clearance check below
compare department **names**, not ids. Names are tenant-scoped and human-
readable, which keeps tool source legible
(`dataScope: { department: 'finance' }`) at the cost of needing one literal
update when a department is renamed (we judged that moving cost low).

To prevent capitalization drift from accidentally denying legitimate
callers ("Finance" vs "finance" vs " finance "), the gate compares names
through a single normalizer:

```ts
// lib/mcp/policy.ts — the only place this rule lives.
export function normalizeDepartmentName(name: string): string {
  return name.trim().toLowerCase();
}
```

Rules of engagement:

- Any code that compares a department name MUST route through
  `normalizeDepartmentName`. Do not re-implement `toLowerCase().trim()`
  inline, do not introduce a second normalizer with subtly different rules
  (e.g. stripping punctuation). If the rule needs to change, it changes
  here and nowhere else.
- The same normalizer governs the Executive-clearance check
  (`normalizeDepartmentName(membership.department.name) === 'executive'`),
  so "EXECUTIVE", "Executive", and " executive " all grant `tenant_admin`
  consistently with the `{ department }` check.
- Tenant-scoped uniqueness of department names is enforced at the database
  layer; this normalizer is *not* a security boundary on its own — it is
  the matching rule applied on top of an already-trusted name.

### How `tenant_admin` clearance is granted — one source of truth

**Decision (Option A — department-name convention):** a `Membership` carries
`tenant_admin` clearance **if and only if** its `Department.name` equals
`"Executive"` (case-insensitive). No flag, no separate clearance table, no
permission string. The department *is* the clearance.

```text
Membership.department.name.toLowerCase() === 'executive'
  └─► tenant_admin scope granted (company-wide access)

anything else
  └─► bounded by that membership's own department
```

Implications:

- The seed/admin flow MUST create exactly one department per tenant named
  `Executive` for the people who need cross-department access.
- The role field (`admin` / `employee`) is **orthogonal** to the department axis.
  An `Executive`-department `employee` can read company-wide data but cannot
  write it; a Finance-department `admin` can write Finance data but cannot
  read Sales data. Both gates must pass.
- "Company-wide cleared?" has **one** answer in the codebase: the
  department-name check. Do not add a `Membership.tenantAdminScope` boolean,
  a `clearance` table, or a `permissions: string[]` field that re-answers
  the same question. If you find yourself reaching for one, you are
  drifting from this contract — stop and revisit this section first.

### When (and only when) to upgrade

If a customer eventually needs finer-grained clearance (e.g. "company-wide
read but not write", or multiple disjoint cross-department roles), upgrade
to **Option B**: add `Membership.tenantAdminScope: Boolean @default(false)`
and migrate the department-name check to read the flag. Do this only when
that requirement actually lands; pre-emptively adding the column is what
this section exists to prevent.

---

## 6. Policy Gate — Implementation Reference

§5 describes *why* the two axes exist. This section describes *how* the gate
runs in code: the order of decisions, what the denial payload looks like, what
crosses the wire to the LLM, and which concerns deliberately stay outside the
gate. Read alongside `lib/mcp/policy.ts`, `lib/mcp/client.ts`, and
`lib/mcp/registry.ts`.

### 6.1 The three-gate evaluation order

`evaluatePolicy()` runs three independent gates in series. First failure wins;
its `gate` label and `reason` ride out unchanged.

```text
   +-------------------------------------------+
   | Inputs:                                   |
   |   ctx  = { userId, tenantId,              |
   |            departmentId, role }           |
   |   tool = { name, capability,              |
   |            dataScope?, domain? }          |
   +--------------------+----------------------+
                        |
                        v
            +------------------------+
            | GATE 1: roleGate       |
            | capability vs role     |
            | (read | write | admin) |
            +-----+----------+-------+
              deny|          |allow
                  v          v
          gate='role'   +-------------------------+
                        | GATE 2: scopeGate       |
                        | dataScope vs department |
                        | public | own_department |
                        | {department:X} |        |
                        | tenant_admin            |
                        +-----+----------+--------+
                          deny|          |allow
                              v          v
                      gate='scope' +-----------------+
                                   | GATE 3: rate    |
                                   | token bucket    |
                                   | per (tenant,    |
                                   | user) 30 burst  |
                                   | 1 rps           |
                                   +----+-------+----+
                                    deny|       |allow
                                        v       v
                                 gate='rate'  ALLOW
                                                v
                                       dispatch to server
```

Properties this layout buys:

- **Pure AND, no cross-talk.** Each gate reads only its own axis. `roleGate`
  never reads `departmentId`; `scopeGate` never reads `role` (the
  `tenant_admin` branch reads `department.name`, not role — see §5).
- **First-failure-wins, labeled.** The label tells dashboards and tests
  *which* gate denied without parsing reason strings.
- **Safe to extend.** Adding a fourth axis (time-of-day, IP allowlist) means
  inserting a new gate; it cannot accidentally relax an existing one.

### 6.2 Denial payload — the contract returned to the agent

When any gate denies, the runtime in `lib/mcp/client.ts` constructs a
single-shape result and writes it both to the tool's reply channel and to the
`ToolInvocation` row.

```ts
// Shape returned to the agent and persisted in ToolInvocation.result
{
  ok: false,
  summary: "denied: Tool ... is restricted to ...",
  data: null,
  error: {
    code: -32002,                          // RpcErrorCode.Forbidden
    message: "<human-readable reason>",
    gate: "role" | "scope" | "rate",       // present only on denials
    suggested_alternative?: "<qualified.tool.name>",
  },
  server, tool, latencyMs,
}
```

Two design rules captured here:

- **`code` stays `Forbidden` for every denial.** Transport is one category;
  the `gate` label is metadata. Nothing should branch on `gate` for control
  flow — only for analytics, audit triage, and graceful-refusal UX.
- **The denial is data, not an exception.** It rides back to the agent
  through the same tool-result channel as a successful call (with `ok:false`).
  This is what lets a sufficiently strong LLM produce a graceful "I can't
  show that, but I can show this instead" reply instead of a stack trace.

### 6.3 `suggested_alternative` — the cheap graceful-refusal hint

When `scopeGate` denies and the denied tool has a `domain` tag,
`registry.findScopeAlternative()` walks the registered tools (in registration
order, first match wins) for another tool that:

- shares the same `domain`,
- is not the denied tool itself,
- would pass `scopeGate` for this caller.

If one is found, its qualified name (`server.tool_name`) is attached to
`error.suggested_alternative`. The agent can choose to call that alternative
on the next round; the gate will of course re-evaluate that call independently.

Order-dependence is intentional: deterministic across requests, simple to
reason about, no sorting heuristics. The cost is O(N) over the registered
tool list per scope denial — fine at the current scale (~14 tools); revisit
if denials become a hot path or the catalog crosses ~100 tools.

`role` and `rate` denials do **not** populate `suggested_alternative` — there
is no "try this instead" answer for "you don't have write access" or "wait a
second."

### 6.4 What crosses the wire to the LLM (and what doesn't)

The agent runtime (`lib/agents/hermes.ts`) projects each `RegisteredTool`
into the OpenAI tool-calling shape via `toOpenAITool()`. **Only three fields
cross the wire:**

```ts
{
  type: 'function',
  function: {
    name: safeName(tool.name),
    description: tool.description,
    parameters: { type: 'object', properties: ..., required: ... },
  },
}
```

Specifically **NOT exposed** to the LLM:

- `dataScope`     — gate-side concern; the model doesn't need to know to call.
- `domain`        — registry-side hint; only used for `findScopeAlternative`.
- `capability`    — gate-side concern.

Rationale: keeping these off the wire (a) reduces tool catalog noise, (b)
prevents the model from "self-policing" in subtly wrong ways that mask gate
behavior, and (c) ensures the model cannot leak scope topology to a curious
end user just by being asked. The single source of truth for who can call
what stays in `lib/mcp/policy.ts`.

If you observe the agent routinely picking the wrong-scope variant of a
tool, surface a *description-level* hint (e.g. "for company-wide P&L use
`x`, for department-level use `y`") rather than exposing `dataScope` —
description text is the right place for the LLM-facing nudge.

### 6.5 Row-level filtering is the tool's responsibility

The gate answers *"can the caller call this tool at all?"*. It does **not**
answer *"which rows can the caller see?"*. That second concern lives inside
the tool's `impl`, using the `ToolCallContext` it receives.

Three layers, three responsibilities:

```text
Layer 1 — RBAC (capability)        : roleGate    in lib/mcp/policy.ts
Layer 2 — Data scope (department)  : scopeGate   in lib/mcp/policy.ts
Layer 3 — Row filter (which rows)  : the tool body, using ctx.departmentId,
                                     ctx.tenantId, ctx.userId
```

For example, an `'own_department'`-scoped report is admitted by Layer 2
*only* if the caller has a department; Layer 2 does **not** verify that the
report's SQL actually filters by `department_id`. That's the tool author's
contract:

```ts
// Inside a tool with dataScope: 'own_department':
const rows = await this.runQuery(
  `SELECT ... FROM report
     WHERE quarter = ? AND department_id = ?`,
  [args.quarter, ctx.departmentId],
);
```

If a tool author forgets the `WHERE department_id = ?` clause, the gate will
happily route the call and rows will leak across departments. The gate
cannot save you from a forgotten WHERE clause; that is a code-review
responsibility. (A future iteration can move row-level enforcement into
Postgres RLS or a repository pattern; that is a Layer 3 concern, not a gate
concern.)

### 6.6 What the gate persists for audit

Every gate decision — pass or fail — eventually becomes a `ToolInvocation`
row (denied / ok / error) plus an `AuditEvent` row. The denial payload
described in §6.2 is what lands in `ToolInvocation.result`, queryable via:

```sql
SELECT tool, status,
       json_extract(result,'$.error.gate')                  AS gate,
       json_extract(result,'$.error.suggested_alternative') AS alt
FROM ToolInvocation
WHERE status = 'denied'
ORDER BY createdAt DESC;
```

This is the canonical query for "which gate denied which user's call to
which tool, and what alternative did the system surface?" — the same shape
a future admin/observability surface (the deferred "Hermes-Main") would
consume.

### 6.7 What is deliberately *out* of scope for this iteration

To keep the gate small, several adjacent capabilities have been deferred and
recorded here so a future contributor doesn't reinvent them by accident:

- **No `Permission` table.** `lib/rbac.ts`'s enum-and-map is the role axis;
  do not introduce DB-backed permission strings until customer config
  demands it.
- **No `PolicyEngine` class or external DSL** (OPA, Cedar, Casbin). Three
  pure functions in `policy.ts` are sufficient at this scale.
- **No `tenantId` variant in `DataScope`.** Tenant isolation is enforced
  upstream in `withGuard` + every Prisma query; mixing it into `DataScope`
  would re-collapse two layers that are deliberately kept apart.
- **No `dataScope` exposed in the LLM-visible catalog.** See §6.4.
- **No admin chat surface (Hermes-Main) reading `ToolInvocation`.** That is
  a separate, larger workstream — the database query in §6.6 is the
  forward-compatible interface it will eventually consume.

Reach for any of these only when a concrete requirement lands that the
current shape cannot express. Pre-emptively adding them is what this
section exists to prevent.

---

## 7. Third-Party Integration Workflow — Google Calendar

The `calendar` MCP server is a real integration; it shows the shape every future
integration (NetSuite, QuickBooks, Square…) will follow once their mocked servers
are pointed at live APIs.

```text
Participants:
  U       = User
  App     = /app/configuration
  Start   = GET /api/integrations/google/start
  Google  = Google OAuth
  CB      = GET /api/integrations/google/callback
  DB      = Prisma
  Chat    = Chat turn (later)
  Cal     = calendar MCP server
  GAPI    = Google Calendar API

  U     App   Start  Google   CB    DB    Chat   Cal   GAPI
  |      |      |      |      |     |      |     |     |
  |--- OAUTH CONNECT ---|     |     |      |     |     |
 1| click "Connect Google Calendar"  |     |      |     |     |
  |----->|      |      |      |     |      |     |     |
 2|      | redirect    |      |     |      |     |     |
  |      |----->|      |      |     |      |     |     |
 3|      |      | 302 with client_id, scope, state(tenantId,userId)
  |      |      |----->|      |     |      |     |     |
 4| consent     |      |      |     |      |     |     |
  |------------>|      |      |     |      |     |     |
 5|      |      |      | 302 with code + state    |     |
  |      |      |      |----->|     |      |     |     |
 6|      |      |      | exchange code for tokens |     |
  |      |      |      |<-----|     |      |     |     |
 7|      |      |      |      | persist refresh_token on Resource(tenant, user)
  |      |      |      |      |---->|      |     |     |
 8|<------------------------- redirect /app/configuration?connected=calendar
  |      |      |      |      |     |      |     |     |
  |== Later, during a chat turn ===================|
  |      |      |      |      |     |      |     |     |
 9|      |      |      |      |     |      | invoke("calendar.list_events", args, ctx)
  |      |      |      |      |     |      |---->|     |
10|      |      |      |      |     |      |     | load stored refresh_token for ctx.tenantId
  |      |      |      |      |     |<-----------|     |
11|      |      |      |      |     |      |     | list events (using access_token)
  |      |      |      |      |     |      |     |---->|
12|      |      |      |      |     |      |     |<----| events
13|      |      |      |      |     |      |<----| normalized result
  |      |      |      |      |     |      |     |     |
  v      v      v      v      v     v      v     v     v
```

---

## 8. Data Model

```text
Relationships  ( 1 ---< many ):

    User    1 ---< Membership          (a user has many memberships)
    Tenant  1 ---< Membership          (a tenant has many memberships)
    Tenant  1 ---< Department          (a tenant owns many departments)
    Tenant  1 ---< Resource            (a tenant owns many resources)
    Tenant  1 ---< TenantMcpDomain     (a tenant activates many MCP domains)
    Department 1 ---< Membership       (a department groups many memberships)
    Department 1 ---< Resource         (a department groups many resources)

    ChatSession 1 ---< ChatMessage     (a session contains many messages)
    ChatMessage 1 ---< ToolInvocation  (a message can trigger many tool calls)

Entity diagram:

    +---------------+         +-----------------+         +---------------+
    |     User      |         |    Membership   |         |    Tenant     |
    |---------------|         |-----------------|         |---------------|
    | id        PK  |1------<*| id          PK  |*>------1| id        PK  |
    | email     UK  |         | userId      FK  |         | name          |
    | name          |         | tenantId    FK  |         +-------+-------+
    +---------------+         | departmentId FK |                 |
                              | role            |                 |
                              | admin|employee  |                 |
                              +--------+--------+                 |
                                       |                          |
                                       *                          |
                              +--------+--------+                 |
                              |   Department    |                 |
                              |-----------------|                 |
                              | id          PK  |*>---------------+
                              | tenantId    FK  |
                              | name            |
                              +--------+--------+
                                       |
                                       1
                                       |
                              +--------+--------+         +---------------------+
                              |    Resource     |         |   TenantMcpDomain   |
                              |-----------------|         |---------------------|
                              | id          PK  |         | id              PK  |
                              | tenantId    FK  |*>------1| tenantId        FK  |
                              | departmentId FK |         | domain              |
                              | name            |         | active        bool  |
                              | data        JSON|         +---------------------+
                              +-----------------+

    +-------------------+   +----------------------+   +----------------------+
    |    AuditEvent     |   |     ChatSession      |   |     ChatMessage      |
    |-------------------|   |----------------------|   |----------------------|
    | id            PK  |   | id              PK   |   | id              PK   |
    | userId        FK  |   | userId          FK   |   | sessionId       FK   |
    | tenantId      FK  |   | tenantId        FK   |   | role: user|assistant |
    | action            |   | title                |   |       |system|tool   |
    | resourceType      |   | memory          JSON |   | agent: hermes|host.. |
    | resourceId        |   +----------+-----------+   | content              |
    | metadata     JSON |              |1              | metadata        JSON |
    +-------------------+              |               +----------+-----------+
                                       *                          |1
                              +--------+--------+                 |
                              | (ChatMessage)   |                 *
                              +-----------------+        +--------+----------+
                                                         |  ToolInvocation   |
                                                         |-------------------|
                                                         | id            PK  |
                                                         | messageId     FK  |
                                                         | sessionId     FK  |
                                                         | server            |
                                                         | tool              |
                                                         | params       JSON |
                                                         | result       JSON |
                                                         | status: pending|  |
                                                         |    ok|error|denied|
                                                         | latencyMs    int  |
                                                         +-------------------+

Legend:
  PK = primary key, FK = foreign key, UK = unique key
  1------<*   one-to-many (1 on the left, many '*' on the right)
  *>------1   many-to-one (many '*' on the left, 1 on the right)
```

---

## 9. Deployment Topology

```text
                          +-------------------+
                          |      Browser      |
                          +---------+---------+
                                    |
                         HTTPS      |      HTTPS
                  +-----------------+-----------------+
                  |                                   |
                  v                                   v
        +-------------------+              +-----------------------+
        |     Edge / CDN    |              |   App host (Node 18+) |
        |-------------------|              |-----------------------|
        | website/          |              |  Next.js 14           |
        | static HTML+CSS+JS|              |  frontend/            |
        +-------------------+              +-----+-----------+-----+
                                                 |           |
                                Prisma / file    |           | HTTP localhost:8642
                                                 v           v
                                       +-----------------+   +----------------------------+
                                       |  SQLite file    |   |   Agent host (Python)      |
                                       |  dev.db         |   |----------------------------|
                                       +-----------------+   |  hermes-agent service      |
                                                             |  uvicorn                   |
                                                             |  /v1/chat/completions :8642|
                                                             +----------------------------+

                                                 |
                                  OAuth + REST   |           future
                                                 v           v
                                       +-------------------+ +----------------------------+
                                       |   External SaaS   | |   External SaaS (planned)  |
                                       |-------------------| |----------------------------|
                                       |  Google APIs      | |  NetSuite / QuickBooks /   |
                                       |                   | |  Square (mocked today)     |
                                       +-------------------+ +----------------------------+
```

Connections:
- `Browser  --HTTPS-->  Edge / CDN`        (marketing site, static assets)
- `Browser  --HTTPS-->  Next.js app host`  (product UI + API)
- `Next.js  --Prisma--> SQLite file`       (`dev.db`)
- `Next.js  --HTTP-->   hermes-agent`      (localhost:8642)
- `Next.js  --OAuth+REST--> Google APIs`
- `Next.js  --future-->  NetSuite / QuickBooks / Square`  (mocked today)

### Env vars that wire it together

- `HERMES_AGENT_BASE_URL` — default `http://127.0.0.1:8642/v1`
- `HERMES_AGENT_MODEL` — default `hermes-agent`
- `HERMES_AGENT_API_KEY` — optional bearer for the Hermes service
- `HERMES_AGENT_TIMEOUT_MS` — default `120000`
- `HERMES_AGENT_MAX_TOOL_ROUNDS` — default `8` (max tool-call rounds per turn)
- `DATABASE_URL` — Prisma SQLite URL (`file:./dev.db`)
- Google OAuth: client id / secret / redirect URI consumed by `lib/integrations/google-calendar.ts`

---

## TL;DR

> The browser hits a Next.js 14 app. Every protected route flows through a cookie
> guard that produces a `(userId, tenantId, role)` context. The **Host** persists
> the chat session, picks the tenant's active **MCP domain** (a curated slice of
> tool servers), and hands a tool catalog to the **Hermes Agent** Python service
> over an OpenAI-compatible HTTP API. Hermes decides whether to answer directly
> or call MCP tools; tool calls are executed locally by the **MCP Client**, which
> enforces RBAC + rate limits, runs the in-process tool server (e.g. `calendar`
> talks to real Google APIs), and records every step as a `ToolInvocation` for
> audit. The final reply, full trace, and updated session memory are persisted
> back to SQLite via Prisma before responding to the browser.
