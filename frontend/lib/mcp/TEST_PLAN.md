# KindCaddy MCP Workflow Test Plan

> **Status — historical reference, not the live test contract.**
>
> This document was written against the **pre-migration 4-role RBAC system**
> (`viewer` / `editor` / `admin` / `owner`). The role system has since been
> simplified to two roles (`admin` / `employee`) — see migration
> `prisma/migrations/20260506000000_simplify_roles_and_user_mcp_access/`.
>
> The test scenarios below remain valuable as a record of the **intended
> coverage surface** for the MCP workflow (domain activation, tool dispatch,
> Hermes contract, UI behavior). When reading scenarios that mention
> `viewer` / `editor` / `owner`:
>
> - Map `owner` → `admin`.
> - Map `viewer` and `editor` → `employee`.
> - Capability boundaries (`read` / `write` / `admin`) collapse accordingly:
>   `employee` calls `read`-only tools by default; `admin` calls everything.
>
> The **authoritative live test contract** is `TESTING.md` at the repo root
> plus the suites under `frontend/__tests__/`. If a scenario here disagrees
> with the current code, the current code wins.

## Purpose

Validate that the KindCaddy assistant workflow correctly routes domain-specific user
requests through Hermes to the right MCP tools, enforces tenant and role policy,
records tool execution/audit history, and presents accurate results in the chat
UI.

This plan is written for the current implementation:

- Hermes is the primary agent runtime.
- KindCaddy exposes MCP tools through the registry/client layer.
- NetSuite, QuickBooks, Square, and Files are mocked.
- SQLite uses real tenant-scoped Prisma data.
- Google Calendar has a real integration surface.
- Email is not registered as an MCP server yet.
- Owners manage tenant-level MCP domain activation from the assistant UI.
- Employees only see and use domains activated by an owner.

## Current System Under Test

Primary path:

1. User sends a prompt from `/app/assistant`.
2. `/api/mcp/chat` validates the request and calls `Host.chat()`.
3. `Host.chat()` persists the chat turn and invokes `ExternalHermesAgent`.
4. Hermes receives OpenAI-style tool definitions from the MCP registry.
5. `Host.chat()` limits exposed tools to the selected active MCP domain.
6. Hermes selects a tool, or returns a JSON fallback tool call.
7. `MCPClient` enforces RBAC/rate policy, dispatches the MCP server call,
   normalizes the response, persists `ToolInvocation`, and writes audit events.
8. The assistant response, trace, and tool cards are shown in the UI.

Domain activation path:

1. `/api/mcp/domains` returns the tenant's MCP domains and active state.
2. Owners can update active domains for the tenant.
3. The assistant domain button shows only active domains.
4. `/api/mcp/tools` returns only servers/tools in active domains.
5. `/api/mcp/chat` rejects inactive domains and only exposes tools for the
   selected active domain.

## Test Roles

Use seeded users or test fixtures for each role:

| Role | Expected MCP capability |
| --- | --- |
| `viewer` | Can call `read` tools only |
| `editor` | Can call `read` and `write` tools |
| `admin` | Can call `read`, `write`, and `admin` tools |
| `owner` | Can call `read`, `write`, and `admin` tools |

Only `owner` can activate or deactivate tenant MCP domains.

## MCP Tool Coverage

| Domain | Server | Tool | Capability | Status |
| --- | --- | --- | --- | --- |
| Finance | `netsuite` | `list_invoices` | read | Mock |
| Finance | `netsuite` | `get_invoice` | read | Mock |
| Finance | `netsuite` | `total_outstanding` | read | Mock |
| Finance | `quickbooks` | `sync_invoice` | write | Mock |
| Finance | `quickbooks` | `list_synced` | read | Mock |
| Customer | `square` | `list_customers` | read | Mock |
| Customer | `square` | `find_customer` | read | Mock |
| Agent data | `sqlite` | `list_resources` | read | Real DB |
| Agent data | `sqlite` | `count_resources` | read | Real DB |
| Agent data | `sqlite` | `search_users` | read | Real DB |
| Agent data | `sqlite` | `recent_audit` | read | Real DB |
| Files | `files` | `list` | read | Mock |
| Files | `files` | `read` | read | Mock |
| Files | `files` | `write` | write | Mock |
| Calendar | `calendar` | `find_availability` | read | Integration |
| Calendar | `calendar` | `create_event` | write | Integration |
| Email | not registered | n/a | n/a | Future |

## Test Data

Seed or prepare:

- Tenant A and Tenant B, each with at least one user per role.
- At least two departments per tenant.
- Resources and audit events for each tenant/department.
- Mock invoice IDs: `INV-1001`, `INV-1002`, `INV-1003`, `INV-1004`, `INV-1005`.
- QuickBooks sync test invoice: `INV-2201`, customer `ACME`, amount `1300`.
- Square customer lookup values: `jordan@example.com`, `Taylor Fox`, `CUST-101`.
- Files: `welcome.md`, `roadmap.md`, and one generated write file.
- Calendar test window with one available slot and one busy block.
- Tenant MCP domains all active by default, then toggled per activation test.

## Domain Activation And Employee Access

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| DA-001 | Owner sees domain management | Login as owner and open `/app/assistant` | Owner MCP access panel is visible with Finance, Customer, and Agent workspace toggles |
| DA-002 | Employee does not see domain management | Login as editor/viewer employee | Owner MCP access panel is hidden |
| DA-003 | Owner deactivates Finance | Owner turns off Finance domain | Finance disappears from active-domain dropdown; `/api/mcp/domains` marks Finance inactive |
| DA-004 | Employee cannot select deactivated Finance | Login as employee after Finance is off | Domain button lists only active domains; Finance is absent |
| DA-005 | Employee cannot call deactivated Finance directly | POST `/api/mcp/chat` with `domain: "finance"` | Request fails with inactive-domain error; no Finance tool invocation is created |
| DA-006 | Tools endpoint respects activation | Fetch `/api/mcp/tools` as employee after Finance is off | `netsuite` and `quickbooks` tools are absent |
| DA-007 | Owner reactivates Finance | Owner turns Finance back on | Finance returns to dropdown and Finance tools return to `/api/mcp/tools` |
| DA-008 | Last active domain cannot be removed | Owner tries to deactivate the only active domain | UI disables the final active toggle or API rejects with validation error |
| DA-009 | Domain state is tenant scoped | Owner in Tenant A disables Customer | Tenant B still sees Customer if active there |
| DA-010 | Domain change is audited | Owner updates active domains | `mcp.domains.updated` audit event records active domain ids |

## Tool Selection Matrix

These tests answer the key question: "Will the agent choose the right MCP tool
when the user asks domain-related prompts?"

| ID | Active selected domain | Prompt | Expected tool behavior | Expected assistant behavior |
| --- | --- | --- | --- | --- |
| TS-001 | Finance | "List unpaid invoices from NetSuite" | Calls `netsuite.list_invoices` with `status: "unpaid"` | Summarizes unpaid invoices only |
| TS-002 | Finance | "Show invoice INV-1002" | Calls `netsuite.get_invoice` with `id: "INV-1002"` | Returns that invoice or clear not-found error |
| TS-003 | Finance | "What is our total outstanding invoice balance?" | Calls `netsuite.total_outstanding` | Reports total USD and source |
| TS-004 | Finance | "List all synced invoices in QuickBooks" | Calls `quickbooks.list_synced` | Reports current synced records |
| TS-005 | Finance | "Sync invoice INV-2201 for ACME for 1300 dollars to QuickBooks" | Calls `quickbooks.sync_invoice` with all required fields | Confirms write side effect and synced record |
| TS-006 | Customer | "List all customers from Square" | Calls `square.list_customers` | Summarizes Square customers |
| TS-007 | Customer | "Find customer jordan@example.com" | Calls `square.find_customer` with `query` | Returns matching customer details |
| TS-008 | Agent workspace | "Read welcome.md" | Calls `files.read` with `path: "welcome.md"` | Returns file content summary |
| TS-009 | Agent workspace | "Create a note file called qa.md that says hello" | Calls `files.write` only for editor/admin/owner | Confirms created file and metadata |
| TS-010 | Agent workspace | "How many resources do we have?" | Calls `sqlite.count_resources` | Reports tenant/department-scoped count |
| TS-011 | Agent workspace | "Search users named Jimmy" | Calls `sqlite.search_users` with `q` | Returns only users in the caller tenant |
| TS-012 | Agent workspace | "Find a 30-minute opening tomorrow afternoon" | Calls `calendar.find_availability` | Lists available slots |
| TS-013 | Agent workspace | "Create a calendar event for tomorrow at 2pm called Client follow-up" | Calls `calendar.create_event` when date/time resolves | Confirms event details |
| TS-014 | Finance | "Email the invoice to ACME" | Does not call unrelated tools until email MCP exists | Explains email is not available or asks to draft only |
| TS-015 | Customer | "Handle the customer context for Jordan" | Uses `square.find_customer` | Avoids guessing unrelated finance data |
| TS-016 | Finance | "Use the right business system for invoice sync work" | Identifies QuickBooks for sync and NetSuite for invoice lookup | Explains which system is used for what |

Acceptance criteria:

- Correct server and tool are visible in the tool invocation card.
- Tool arguments match the prompt intent.
- No unrelated write tool is called.
- The final answer names the relevant source system.
- Tool errors are summarized without exposing stack traces.
- No tool outside the selected active domain is advertised to Hermes or invoked.

## Functional Test Cases

### Happy Path Completion

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| HP-001 | Start a new finance chat and read invoices | Select finance view, send "List unpaid invoices from NetSuite" | Session is created, `netsuite.list_invoices` runs, assistant returns invoice summary |
| HP-002 | Sync invoice to QuickBooks | As editor/owner, send "Sync invoice INV-2201 for ACME, amount 1300" | `quickbooks.sync_invoice` succeeds, `list_synced` later includes the record |
| HP-003 | Customer lookup | Select customer view, send "Find customer jordan@example.com" | `square.find_customer` succeeds and displays Jordan's profile |
| HP-004 | File read/write round trip | As editor, write `qa.md`, then read it | Write succeeds, read returns same content |
| HP-005 | Calendar availability | Ask for open slots in a valid ISO time window | `calendar.find_availability` returns slots or an empty slots list |

### Required Field Validation

| ID | Scenario | Input | Expected result |
| --- | --- | --- | --- |
| RF-001 | Empty chat message | POST `/api/mcp/chat` with empty `message` | HTTP 400 `message is required` |
| RF-002 | Missing invoice id | Prompt "Show invoice details" | Agent asks for invoice ID, or tool returns validation/not-found cleanly |
| RF-003 | Missing QuickBooks amount | Prompt "Sync invoice INV-2201 for ACME" | Agent asks for amount before write, or tool result is marked error |
| RF-004 | Missing file path | Direct or fallback call to `files.read` without `path` | Error result, persisted invocation status `error` |
| RF-005 | Missing calendar start/end | Prompt "Find calendar availability" without date/time | Agent asks for time window before tool call |

### Invalid Data Rejection

| ID | Scenario | Input | Expected result |
| --- | --- | --- | --- |
| IV-001 | Invalid invoice id | `netsuite.get_invoice` with `INV-9999` | Tool error "Invoice INV-9999 not found"; audit event recorded |
| IV-002 | Invalid customer lookup | `square.find_customer` with unknown email | Tool error "No customer found"; assistant explains no match |
| IV-003 | Invalid calendar date | `calendar.find_availability` with non-ISO date | Tool error says date must be valid ISO timestamp |
| IV-004 | Calendar end before start | End timestamp earlier than start | Tool error says end must be after start |
| IV-005 | Invalid file path | `files.read` with missing file | Tool error "File not found" |
| IV-006 | Negative or non-number invoice amount | Prompt sync amount `-5` or `abc` | Current mock coerces with `Number`; expected future behavior should reject non-positive/non-finite amounts |

### Approval And Rejection Branches

There is no dedicated human approval workflow in the current code. Current tests
should verify intent clarity, RBAC denial, and clean refusal. When an approval
gate is added, these same cases should assert approval records and reviewer
actions.

| ID | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| AP-001 | Explicit write intent | As editor, ask to sync a specific invoice with all fields | Write proceeds and side effect is reported |
| AP-002 | Ambiguous write intent | Ask "Can you handle this invoice?" without target/action | Agent asks a clarifying question before write |
| AP-003 | Viewer attempts write | As viewer, ask to sync invoice to QuickBooks | Policy denies write; no side effect occurs |
| AP-004 | Rejected action equivalent | As viewer, ask to create a calendar event | `calendar.create_event` denied by policy |
| AP-005 | Future human approval accepted | Submit high-risk write, approver accepts | Tool runs only after approval and audit links approval to invocation |
| AP-006 | Future human approval rejected | Submit high-risk write, approver rejects | Tool never runs; assistant reports rejection reason |

### Permission By Role

| ID | Role | Tool type | Expected result |
| --- | --- | --- | --- |
| RBAC-001 | viewer | `read` | Allowed |
| RBAC-002 | viewer | `write` | Denied with `Forbidden` policy result |
| RBAC-003 | editor | `read` | Allowed |
| RBAC-004 | editor | `write` | Allowed |
| RBAC-005 | admin | `read`/`write`/`admin` | Allowed where tools exist |
| RBAC-006 | owner | `read`/`write`/`admin` | Allowed where tools exist |
| RBAC-007 | unauthenticated | any `/api/mcp/*` route | HTTP 401 |
| RBAC-008 | cross-session access | Tenant A user requests Tenant B session id | Session not found or forbidden; no messages leaked |

### Integration Success

| ID | Scenario | Expected result |
| --- | --- | --- |
| INT-001 | `/api/mcp/tools` lists registry | Returns all registered servers and tool descriptors |
| INT-002 | MCP client invokes registered read tool | Normalized result has `ok: true`, server, tool, latency |
| INT-003 | MCP client invokes registered write tool | Tool result persisted with status `ok` |
| INT-004 | Hermes native tool call path | Native `tool_calls` are converted and executed |
| INT-005 | Hermes JSON fallback path | `kindcaddy_tool_call` JSON is parsed and executed |
| INT-006 | Calendar client success | Calendar response is normalized and summarized |
| INT-007 | Mock QuickBooks success | Synced record is visible through `list_synced` for same tenant |

### Integration Failure And Retry

The current MCP client records failures but does not implement automatic retry.
Treat retry assertions as future tests unless retry is added.

| ID | Scenario | Expected result |
| --- | --- | --- |
| IF-001 | Unknown tool name | Result is `ok: false`, status `error`, no crash |
| IF-002 | Registered server throws | Result is normalized with `ToolError`, invocation persisted |
| IF-003 | Hermes gateway unavailable | `/api/mcp/chat` returns controlled error, no partial tool side effect |
| IF-004 | Hermes timeout | Request fails after configured timeout and UI shows error |
| IF-005 | Calendar auth missing/expired | Tool returns clear integration error; audit event recorded |
| IF-006 | Future retry success | Transient provider failure succeeds on retry and records retry count |
| IF-007 | Future retry exhausted | Final response reports failure after max retries and avoids duplicate writes |

### Notification Accuracy

No outbound notification server exists yet. Current notification coverage means
chat UI feedback, tool cards, trace entries, and error messages.

| ID | Scenario | Expected result |
| --- | --- | --- |
| NT-001 | Successful tool call | Tool card shows server, tool, params, result, latency, status |
| NT-002 | Denied write | UI shows denial summary and does not imply success |
| NT-003 | Tool failure | Assistant states failure accurately and names the failed action |
| NT-004 | Multiple tool calls | Each call has its own trace and card in chronological order |
| NT-005 | Future email notification success | Recipient, subject, body, and source record are correct |
| NT-006 | Future email notification failure | Failure is visible and audited without duplicate send |

### Audit Log Completeness

| ID | Scenario | Expected audit data |
| --- | --- | --- |
| AUD-001 | Chat turn without tool | `mcp.chat.turn` with session id and `toolCalls: 0` |
| AUD-002 | Successful tool call | `mcp.tool.ok` with user id, tenant id, tool name, capability, session id, message id |
| AUD-003 | Denied tool call | `mcp.tool.denied` with denial reason |
| AUD-004 | Failed tool call | `mcp.tool.error` with normalized detail |
| AUD-005 | Audit API tenant scope | `/api/mcp/audit` returns only current tenant events |
| AUD-006 | Recent audit MCP tool | `sqlite.recent_audit` returns only current tenant events |
| AUD-007 | Tool invocation persistence | `ToolInvocation` stores params, result, status, latency, session id, message id |

### Multi-Tenant Isolation

| ID | Scenario | Expected result |
| --- | --- | --- |
| MT-001 | Tenant A writes file | Tenant B cannot list or read Tenant A's generated file |
| MT-002 | Tenant A syncs invoice | Tenant B `quickbooks.list_synced` does not include Tenant A record |
| MT-003 | Tenant A DB resources | Tenant B `sqlite.list_resources` excludes Tenant A resources |
| MT-004 | Tenant A audit events | Tenant B audit API excludes Tenant A events |
| MT-005 | Same user email across tenants | Context tenant controls visibility; no cross-tenant leakage |

### Concurrent Submission

| ID | Scenario | Expected result |
| --- | --- | --- |
| CC-001 | Two users list data concurrently | Both requests complete with correct tenant/user context |
| CC-002 | Two writes to same QuickBooks invoice | Latest write replaces same tenant record without duplicate ids |
| CC-003 | Parallel file writes different paths | Both files exist with correct contents |
| CC-004 | Parallel file writes same path | Final content is deterministic enough for current in-memory mock; no server crash |
| CC-005 | Rate-limit burst | More than 30 rapid tool calls for same tenant/user eventually returns policy denial |
| CC-006 | Concurrent sessions | Tool invocations attach to the correct assistant message/session |

## UI And Compatibility Tests

### Cross-Browser

Run the assistant page and core workflows in:

- Chrome latest
- Safari latest
- Firefox latest
- Edge latest, if Windows QA is available

Expected results:

- Session list loads and updates.
- Chat submit works from button and Enter key.
- Domain button lists only owner-activated domains.
- Owner MCP access panel appears only for owner accounts.
- Tool cards expand/collapse correctly.
- Right-side MCP registry renders all filtered domain servers.
- Errors are readable and do not break layout.
- No browser-specific console errors during happy paths.

### Mobile And Responsive

Run at:

- 390 x 844 mobile viewport
- 768 x 1024 tablet viewport
- 1280 x 800 desktop viewport
- 1440 x 900 desktop viewport

Expected results:

- Chat input remains reachable.
- Session list and MCP registry do not hide critical actions.
- Long tool params/results wrap without horizontal page overflow.
- Loading state is visible while Hermes is processing.
- Domain dropdown and owner toggles remain usable on narrow screens.
- Tool cards remain readable on narrow screens.

## Automation Strategy

### Unit Tests

Add Jest tests for:

- `ToolRegistry.listTools()` and `findTool()`.
- `evaluatePolicy()` for every role/capability combination.
- `BaseMCPServer.handle()` success, unknown method, unknown tool, and thrown tool.
- Individual mock server validation and tenant-scoped behavior.
- `ExternalHermesAgent` parsing native tool calls and JSON fallback tool calls.
- `listTenantMcpDomains()` default creation and `setTenantMcpDomains()` validation.

### Integration Tests

Add tests with a fake Hermes fetch adapter:

- Stub Hermes to return `tool_calls` and assert MCP execution.
- Stub Hermes to return `kindcaddy_tool_call` JSON and assert fallback execution.
- Assert `ToolInvocation` and `AuditEvent` rows are created.
- Assert denied calls persist as status `denied`.
- Assert chat responses preserve session/message linkage.
- Assert inactive domain chat requests are rejected before Hermes tool exposure.
- Assert `/api/mcp/tools` returns only active-domain tools.
- Assert owner domain updates create `mcp.domains.updated` audit events.

### End-To-End Tests

Use Playwright or equivalent once available:

- Login as each role.
- Open `/app/assistant`.
- Execute the tool selection matrix.
- Disable a domain as owner and verify employee UI/API access is removed.
- Reactivate the domain as owner and verify employee access returns.
- Inspect visible tool cards and final answers.
- Verify tenant isolation by switching seeded users.
- Run cross-browser and responsive suites.

## Manual Smoke Checklist

Before demo or release:

- [ ] `/api/mcp/domains` returns active domain state for the tenant.
- [ ] Owner can deactivate and reactivate a domain.
- [ ] Employee sees only activated domains in the domain button.
- [ ] `/api/mcp/tools` returns only active-domain servers.
- [ ] Finance prompt calls NetSuite for invoice lookup.
- [ ] Finance prompt calls QuickBooks for invoice sync/listing.
- [ ] Customer prompt calls Square.
- [ ] File read/write works for an editor and write is denied for viewer.
- [ ] Calendar availability handles valid and invalid time windows.
- [ ] Unknown email request does not call an unrelated tool.
- [ ] Tool cards show params, result, latency, status.
- [ ] `/api/mcp/audit` shows chat and tool audit events.
- [ ] Tenant B cannot see Tenant A files, syncs, resources, or audit logs.
- [ ] Mobile viewport can send prompts and read tool cards.

## Release Gates

Do not mark the workflow complete unless:

- Tool selection passes at least 90% of the matrix with deterministic Hermes
  stubs, and all critical write-selection cases pass.
- Viewer write denial is verified.
- Owner domain activation and employee inactive-domain denial are verified.
- Tenant isolation tests pass for files, QuickBooks mock state, SQLite resources,
  MCP domain activation, sessions, and audit events.
- Every tool call produces either an `ok`, `error`, or `denied` persisted
  invocation when attached to a chat message.
- Audit events are created for successful, failed, and denied tool calls.
- UI smoke passes on desktop and one mobile viewport.

## Open Risks And Follow-Ups

- Domain activation is tenant-wide today, not per employee or department.
- QuickBooks and NetSuite mocks do not validate all business constraints yet,
  such as positive amounts and required invoice/customer consistency.
- Retry behavior is not implemented in the MCP client.
- No email MCP server exists yet, so email prompts should be handled as
  unavailable capability or draft-only responses.
- Notification tests currently cover UI/tool trace accuracy, not outbound
  messages.
- Human approval is not implemented as a persisted workflow; current approval
  coverage relies on clear intent and RBAC denial.
