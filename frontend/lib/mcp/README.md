# KindCaddy MCP Framework

Working implementation of the architecture diagram for the current Hermes-first
runtime. The web app delegates user turns to downloaded Hermes Agent, and Hermes
uses your local Gemma endpoint as its LLM backend.

## Current System Flow

```text
                         KIND AI CURRENT RUNTIME

┌──────────────────┐
│      User        │
│ /app/assistant   │
└────────┬─────────┘
         │ prompt
         ▼
┌──────────────────────────────┐
│ Next.js API                  │
│ /api/mcp/chat                │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Host Layer                   │
│ sessions • auth • audit      │
│ lib/host/host.ts             │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Agents Layer                 │
│ ExternalHermesAgent          │
│ lib/agents/hermes.ts         │
└───────┬────────────────┬─────┘
        │                │
        │ reasoning      │ tool execution
        ▼                ▼
┌───────────────────┐   ┌──────────────────────────────┐
│ Hermes Gateway    │   │ KindCaddy MCP Clients           │
│ 127.0.0.1:8642/v1 │   │ lib/mcp/client.ts            │
└────────┬──────────┘   └──────────────┬───────────────┘
         │                             │
         ▼                             ▼
┌───────────────────┐   ┌──────────────────────────────┐
│ Local Gemma LLM   │   │ KindCaddy MCP Servers           │
│ 127.0.0.1:8080/v1 │   │ sqlite • files • calendar    │
└───────────────────┘   │ netsuite • quickbooks • square│
                        └──────────────────────────────┘

Response returns through: ExternalHermesAgent -> Host -> API -> User
```

Current request path for chat replies:

1. User sends a prompt in `/app/assistant`.
2. KindCaddy Host persists session/message state (Prisma).
3. Host runs `ExternalHermesAgent` from the Agents layer.
4. `ExternalHermesAgent` calls Hermes gateway (`:8642/v1`) with KindCaddy MCP
   tool definitions.
5. Hermes gateway uses local Gemma (`:8080/v1`) to decide whether to answer or
   request a tool call.
6. If Hermes requests a tool, KindCaddy executes it through the MCP client layer
   with the current tenant/user context.
7. Host stores the assistant reply + trace and returns it to the UI.

## Layers

```
User
 │
 ▼
Host / Application  ── lib/host/host.ts, lib/host/session.ts
  • session + memory store (Prisma: ChatSession / ChatMessage)
  • auth enforcement (reuses lib/guard.ts + lib/context.ts)
  • routes prompts through Hermes and records audit events
 │
 ▼
Agents Layer        ── lib/agents/
  • ExternalHermesAgent is the primary runtime
  • calls downloaded Hermes Gateway directly
  • exposes KindCaddy MCP tools to Hermes as OpenAI-style tool specs
  • supports a JSON fallback protocol for local models/gateways that do not
    emit native OpenAI tool calls
 │
 ▼
MCP Clients         ── lib/mcp/client.ts + policy.ts + normalize.ts
  • MCPServerClient: one client instance per registered MCP server
  • MCPClient      : aggregate compatibility client for qualified names
  • evaluatePolicy: RBAC capability check + rate limit
  • normalize:      collapse every JSON-RPC response into { ok, summary, data }
  • persists a ToolInvocation row per call + audit event
 │
 ▼
MCP Servers         ── lib/mcp/servers/
  • sqlite     : real Prisma access, tenant-scoped
  • files      : in-memory per-tenant VFS (swap for S3/Drive)
  • netsuite   : mock ERP (invoices, customers)
  • quickbooks : mock accounting sync target
```

## Per-server MCP clients

Each registered MCP server has its own client instance exposed at
`mcp.serverClients[serverId]`.

Example:

```ts
const quickBooksClient = mcp.serverClients.quickbooks;
const result = await quickBooksClient.invoke('list_synced', {}, context, opts);
```

You can still use the aggregate client when needed:

```ts
await mcp.client.invoke('quickbooks.list_synced', {}, context, opts);
```

`ExternalHermesAgent` normally advertises these tools to Hermes using OpenAI
function specs. If a local Hermes/Gemma stack does not emit native tool calls,
the system prompt also allows Hermes to request a KindCaddy MCP tool using:

```json
{"kindcaddy_tool_call":{"name":"quickbooks.list_synced","arguments":{}}}
```

KindCaddy validates the requested tool name against the registry, executes it
through the MCP client layer, persists the `ToolInvocation`, and then asks
Hermes to summarize the result.

## API surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/mcp/chat` | POST | Send a user turn, get the orchestrated reply + trace |
| `/api/mcp/sessions` | GET / POST | List or create chat sessions |
| `/api/mcp/sessions/[id]` | GET | Full message history (including tool invocations) |
| `/api/mcp/tools` | GET | Discover every MCP server and its tools |
| `/api/mcp/audit` | GET | Recent MCP-related audit events for the tenant |

All routes are guarded via the existing `withGuard()` / RequestContext,
so tenant isolation is enforced end-to-end.

## UI

`/app/assistant` — three-pane chat UI:

- left: persistent sessions
- center: chat stream with collapsible tool-call cards (params, result,
  latency, status) and agent trace
- right: live MCP server / tool registry + request-flow diagram

## Hermes Agent setup

Hermes is a first-class Agents-layer runtime, not an MCP server. To connect the
web app to a real downloaded Nous Hermes Agent process:

1. Install Hermes Agent separately.
2. Add this to `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
```

3. Start the Hermes gateway:

```bash
hermes gateway
```

4. In this app's environment, set:

```bash
HERMES_AGENT_BASE_URL=http://127.0.0.1:8642/v1
HERMES_AGENT_API_KEY=change-me-local-dev
HERMES_AGENT_MODEL=hermes-agent
```

5. Configure the downloaded Hermes Agent to use your local Gemma endpoint
   (for example in `~/.hermes/.env`):

```bash
OPENAI_BASE_URL=http://127.0.0.1:8080/v1
OPENAI_API_KEY=local
HERMES_MODEL=/Users/jimmy/Desktop/SecondBrain/gemma-4-26B-A4B-it
```

Then open `/app/assistant` and chat normally. The web app sends turns to
`ExternalHermesAgent`, which calls the downloaded Hermes Gateway and lets Hermes
choose from the KindCaddy MCP tools.

> **Historical note:** the Hermes gateway setup above is retired — the app
> now calls model providers directly. The section is kept for reference only.

## Swapping in real providers

- **Real LLM**: chat is BYOK-only — each user enters an OpenRouter, OpenAI,
  or Anthropic key under `/app/configuration` (encrypted session cookie;
  auto-detected provider, optional custom base URL for local
  OpenAI-compatible endpoints such as a local Gemma-hosted server). There is
  no platform env key.
- **Real NetSuite / QuickBooks**: replace the in-memory store in
  `lib/mcp/servers/{netsuite,quickbooks}.ts` with REST client calls.
  The tool descriptors, policy layer, and orchestrator stay unchanged.
- **Real Files**: swap `FilesMCPServer`'s `Map` for S3 / Drive /
  SharePoint clients.
