# Security

## Reporting a vulnerability

If you believe you've found a security issue in Kindcaddy, please **do not open a public GitHub issue**. Instead, report it privately so we can fix it before disclosure.

**Preferred channel:** GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) on this repository's Security tab.

**Backup channel:** Email `customersupport@kindcaddy.com`.

Please include:

- A clear description of the vulnerability and the impact.
- Steps to reproduce, ideally a proof-of-concept.
- The affected version / commit SHA.
- Whether you've shared the vulnerability with anyone else.

We'll acknowledge your report within **3 business days** and provide an initial assessment within **7 business days**.

## Our commitment

When you report a vulnerability in good faith, we will:

- Acknowledge receipt promptly.
- Investigate and keep you updated on progress.
- Fix the issue in a timely manner appropriate to its severity.
- Credit you in the release notes when the fix ships (unless you prefer anonymity).
- Not pursue legal action against you for the report itself, provided your research follows standard responsible disclosure practices (no data exfiltration beyond what's needed to demonstrate the issue, no disruption to other users, no public disclosure before the fix).

## Threat model — what Kindcaddy defends against

Kindcaddy's security posture is built on four explicit guarantees, enforced in code:

| Threat | Defense | Where |
|---|---|---|
| Cross-tenant data leak | Every Prisma query filters by `tenantId` derived from `withGuard`'s `RequestContext` | `lib/guard.ts`, `lib/host/*`, `lib/mcp/servers/*` |
| Cross-department data leak | Resources have `departmentId`; queries filter by both `tenantId` and `departmentId` | `lib/host/host.ts`, `lib/mcp/policy.ts` |
| Privilege escalation via tool call | RBAC capability check in the policy gate before any tool runs | `lib/rbac.ts`, `lib/mcp/policy.ts` |
| Model-induced misuse (prompt injection / jailbreak) | The LLM never sees a tool it can't call; denied tool calls are rejected at the gate regardless of model intent | `lib/agents/hermes.ts` (catalog projection), `lib/mcp/policy.ts` (gate) |
| Session hijacking via XSS | `auth_session` cookie is `httpOnly`, `sameSite=lax`, `secure` in prod | `lib/auth.ts` |
| Resource enumeration | Wrong-tenant lookups return 404 (not 403), avoiding existence leak | `app/api/resources/route.ts` and similar |
| Rate-based DoS | Token-bucket rate limiter (30 burst, 1 rps) per `(tenantId, userId)` | `lib/mcp/policy.ts` |

The guarantee is: **even if the LLM tries to do something the user isn't allowed to do, the gate refuses.** The model is not in the trust boundary.

## Encryption of stored OAuth tokens

`Resource.data` is the column that holds per-tenant OAuth refresh tokens (Google Calendar, QuickBooks, …). It is **envelope-encrypted at the application layer** before any write reaches the database:

```
plaintext JSON ──AES-256-GCM──► ciphertext + tag + iv
                                          ▲
                  per-row DEK (32 random) ┘
                       │
                  KEK wrap ◄── ENC_PROVIDER:
                       │         - 'local'   (APP_ENC_KEY, dev/CI)
                       │         - 'aws-kms' (customer-managed CMK, production)
                       ▼
                  wrappedKey

stored value: { v, alg, kek, keyId, wk, iv, ct, tag }  (base64-JSON in TEXT)
```

Implementation: [`frontend/lib/crypto.ts`](./frontend/lib/crypto.ts), exercised by [`frontend/__tests__/lib/crypto.test.ts`](./frontend/__tests__/lib/crypto.test.ts). The KEK in production is a customer-managed KMS CMK provisioned by Terraform (see [`infra/modules/kms`](./infra/modules/kms)). KMS Decrypt is granted only to the ECS task role; no human IAM identity holds Decrypt permission.

A database dump alone reveals no plaintext.

## Out of scope (today)

These are known gaps in the current implementation. None are appropriate for a security report, but PRs and discussion are welcome:

- **CSRF on state-changing API routes.** `sameSite=lax` provides partial defense; a CSRF token is not implemented. (OAuth `state` *is* HMAC-signed and bound to the originating user — see `app/api/integrations/quickbooks/start/route.ts`.)
- **Audit log tamper-evidence.** `AuditEvent` is append-only by convention but not by enforcement; a future change should make it write-once at the database level.
- **Per-tenant data residency.** Single-region today. Multi-region is on the roadmap.
- **The `/api/dev/*` routes.** Dev-only by intent; production must 404 them. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) §3.

## Supported versions

This is a reference / demo implementation, not a versioned product. Security fixes ship to `main`. There are no LTS branches.

## Acknowledgments

Researchers credited for past disclosures will be listed here once we receive any.
