# Operations

The runtime contract for Kindcaddy: what we promise the system will do, how we know when it isn't, and what to do about it.

This is intentionally short. A 50-page runbook nobody reads is worse than five 10-line runbooks the on-call actually opens at 3am.

---

## 1. SLOs

| Surface | Indicator | Target |
|---|---|---|
| `/api/me` | Availability | 99.9% over rolling 28 days |
| `/api/me` | p95 latency | < 300 ms |
| `/api/mcp/chat` | Availability (excluding 4xx) | 99.5% over rolling 28 days |
| `/api/mcp/chat` | p95 latency (end-to-end, includes LLM) | < 8 s |
| Hermes `/v1/chat/completions` | Availability | 99.9% |
| Tool invocation success rate | `ToolInvocation.status = 'ok'` / total non-denied | > 98% |
| Database | Connection success rate | 99.95% |

**Error budget:** 99.5% over 28 days = 3.4 hours of allowed downtime/month. When the budget is exhausted, feature work pauses and reliability work takes priority until the budget recovers.

---

## 2. Dashboards

A production deployment should publish four dashboards:

1. **Service health** — request rate, error rate, p50/p95/p99 latency per route. Sources: CloudWatch + Vercel Analytics.
2. **Tool invocations** — success/error/denied counts by `server` and `tool`, p95 latency by tool. Source: `ToolInvocation` table, surfaced via a 1-min CloudWatch custom metric.
3. **LLM usage** — token count and cost per tenant, per model. Source: Hermes logs.
4. **Database** — connection count, CPU, IOPS, slow query log. Source: RDS Performance Insights.

Each dashboard links to the alerts that fire on it.

---

## 3. Alerts

Severity definitions:

- **P1** — customer-visible outage; page immediately, 24/7.
- **P2** — degraded service or trending toward an outage; page during business hours, ticket overnight.
- **P3** — internal-only or recovers on its own; ticket only.

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| Frontend 5xx spike | `5xx rate > 1%` over 5 min on `/api/*` | P1 | [§5.1](#51-frontend-5xx-spike) |
| Chat latency breach | `/api/mcp/chat` p95 > 15s over 10 min | P2 | [§5.2](#52-chat-latency-breach) |
| Hermes down | Hermes health check failing for 2 min | P1 | [§5.3](#53-hermes-down) |
| RDS CPU sustained | > 80% for 10 min | P2 | [§5.4](#54-rds-cpu-sustained) |
| RDS connections exhausted | > 90% of max for 2 min | P1 | [§5.5](#55-rds-connection-exhaustion) |
| Tool denied rate spike | `ToolInvocation.status='denied'` > 5% over 15 min | P3 | [§5.6](#56-tool-denied-rate-spike) |
| LLM cost spike | Hourly LLM spend > 2× baseline | P3 | [§5.7](#57-llm-cost-spike) |
| Failed migration | Deploy step `prisma migrate deploy` exit ≠ 0 | P1 | [§5.8](#58-failed-migration) |

---

## 4. On-call

| Role | Responsibility |
|---|---|
| **Primary** | First responder. Acknowledges within 5 min during business hours, 15 min overnight. |
| **Secondary** | Escalation if primary doesn't ack within window, or for P1s that require two hands. |
| **Incident commander** | For P1s: coordinates response, owns comms, decides on rollback. |

Handoff: weekly, Mondays at 10am local time. Outgoing primary writes a 2-sentence summary of any open issues into the on-call channel before handing off.

Incident channel: `#kindcaddy-incidents`. Post-mortems are written for every P1 within 5 business days, blameless template, focus on systemic fixes.

---

## 5. Runbooks

### 5.1 Frontend 5xx spike

```
1. Open Vercel dashboard → Logs → filter status:5xx
2. Identify the failing route. If concentrated on /api/mcp/* → continue to §5.3 (Hermes down).
3. If concentrated on /api/me or /api/resources → likely DB. Continue to §5.5.
4. If broad: check Sentry for a new error fingerprint introduced in the last deploy.
5. If introduced by last deploy: roll back via `vercel rollback <previous-deployment-id>`.
6. If not deploy-related: open a P1 incident, page secondary.
```

### 5.2 Chat latency breach

```
1. Check the Tool Invocations dashboard. If a single tool dominates p95 → that tool is degraded.
2. If `quickbooks` / `netsuite` / `square` → external SaaS; check their status page. Mark
   degraded, no action.
3. If `calendar` → Google API. Same as above.
4. If no single tool dominates → likely LLM provider. Check OpenRouter/Anthropic/etc. status.
5. If sustained > 30 min: switch the chat surface to a faster model via
   HERMES_AGENT_MODEL env var; deploy.
```

### 5.3 Hermes down

```
1. AWS Console → ECS → kindcaddy-hermes service. Check Running task count.
2. If 0 tasks: check Service Events for crash reason. Common causes:
   a. Out of memory  → bump task definition memory, redeploy
   b. Health check failing  → check container logs in CloudWatch
   c. LLM provider rejecting auth  → rotate OPENROUTER_API_KEY in Secrets Manager
3. If tasks running but health check failing: `aws ecs execute-command` into the task,
   curl localhost:8642/v1/models. If 500 → restart container.
4. Worst case: failover the frontend to OpenAI direct by unsetting HERMES_AGENT_BASE_URL
   and setting OPENAI_API_KEY in Vercel; redeploy. Loses Hermes-specific features but
   chat works.
```

### 5.4 RDS CPU sustained

```
1. RDS Performance Insights → Top SQL by load.
2. If a query is dominating: get its `query_id`, check whether it's missing an index.
   Look for sequential scans on tenantId/departmentId.
3. Quick mitigation: scale up the RDS instance one class (t4g.small → t4g.medium),
   takes ~5 min with no downtime on Multi-AZ.
4. Long-term: add the missing index in a Prisma migration, deploy.
```

### 5.5 RDS connection exhaustion

```
1. Likely cause: Vercel function over-provisioning connections (no pooler) or a connection
   leak in a recent deploy.
2. Quick mitigation: in Vercel, lower the function concurrency limit to halve connection
   demand. Buy time.
3. Real fix: ensure PgBouncer or Prisma Data Proxy is in front of RDS, with `pgbouncer=true`
   and `connection_limit=1` on the Prisma client.
4. If a single PID is hogging connections: `SELECT pg_terminate_backend(pid) FROM
   pg_stat_activity WHERE state='idle' AND state_change < now() - interval '5 minutes';`
```

### 5.6 Tool denied rate spike

```
1. Open the Tool Invocations dashboard, filter status=denied.
2. If concentrated in one tenant: likely they activated a chat domain whose tools their
   users lack the role for. Ping their admin to either grant the role or deactivate the
   domain.
3. If broad: check if a recent deploy changed the RBAC matrix in lib/rbac.ts. If so,
   that change is potentially breaking; communicate to customers.
4. This alert is informational, not a service failure. No customer page.
```

### 5.7 LLM cost spike

```
1. Check the LLM Usage dashboard. Identify the tenant(s) and model.
2. If a single tenant is dominating: check whether they hit a chat loop (a bug where the
   agent keeps calling tools without making progress). Look at HERMES_AGENT_MAX_TOOL_ROUNDS
   — if it's saturating the limit consistently, that's the loop.
3. Quick mitigation: lower the per-turn max rounds for that tenant, or temporarily switch
   them to a cheaper model.
4. Long-term: add per-tenant token quotas (not implemented today).
```

### 5.8 Failed migration

```
1. The deploy pipeline halts before the new app version starts. The old app is still
   serving on the old schema — no customer impact yet.
2. Check the CI logs for the failure reason. Common causes:
   a. Migration tries to drop a column the old app still uses → migration is not
      forward-compatible. Revert the migration, ship the column-removal in two deploys.
   b. Migration times out on a large table → use a CONCURRENT index, batch the data
      backfill out of the migration.
3. NEVER manually run a partial migration on prod. Either the full migration succeeds
   in CI, or the deploy is aborted and the migration is fixed in a new PR.
```

---

## 6. Rollback procedures

| What | How | Target time |
|---|---|---|
| Frontend (Vercel) | `vercel rollback <deployment-id>` or click "Promote" on previous deployment in dashboard | < 2 min |
| Hermes (ECS) | `aws ecs update-service --task-definition kindcaddy-hermes:<previous-revision>` | < 5 min |
| Database migration | `npx prisma migrate resolve --rolled-back <migration-name>`, then ship a forward-fix | varies — depends on data shape |
| Secret rotation | Update in Secrets Manager → restart ECS service / redeploy Vercel | < 5 min |

A successful canary deploy auto-rolls-back on SLO breach. Manual rollback is the fallback.

---

## 7. Disaster recovery

| Scenario | RTO | RPO | Procedure |
|---|---|---|---|
| RDS instance failure | 1–2 min | 0 | Multi-AZ automatic failover |
| RDS data corruption | 1 hour | 5 min | Point-in-time restore from automated backup |
| Region outage | 4 hours | 1 hour | Restore from cross-region snapshot; redeploy stack via IaC; update Route 53 |
| Accidental data deletion | 1 hour | 5 min | Point-in-time restore to a new instance, copy specific rows back |

DR drill: monthly, restore yesterday's snapshot to a throwaway RDS instance and verify `SELECT count(*) FROM ChatMessage` returns sane numbers. Document the restore time in the on-call channel.

---

## 8. What's out of scope today

Honest gaps the team is aware of:

- No multi-region active-active. Single-region with cross-region snapshot backups.
- No formal customer-facing status page. Manual Slack updates.
- No per-tenant quota enforcement (LLM tokens, tool invocations).
- No automated chaos testing. Manual game days quarterly is the aspiration.

Each of these is acceptable for the demo/MVP stage. They become priorities once paying customers depend on the system.
