# Contributing

Thanks for your interest in Kindcaddy. This is a small project; the contributing guidelines are correspondingly short.

## Before you start

1. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md). The system has a small number of opinionated patterns (policy gate, department scope, MCP framework). Most well-meaning PRs that don't read the architecture first end up reinventing one of these patterns badly.
2. For non-trivial changes, open an issue first describing the change. We'd rather discuss the shape of a change in 200 words than review a 2,000-line PR that goes in the wrong direction.

## Setting up

```bash
git clone https://github.com/<your-org>/kindcaddy.git
cd kindcaddy/frontend
cp .env.example .env
npm ci
npm run db:reset
npm test           # should pass
npm run dev        # http://localhost:3000
```

## Workflow

1. Branch from `main`: `git checkout -b feature/<short-name>`.
2. Make the change. Keep the diff focused; one logical change per PR.
3. Add or update tests. See [`TESTING.md`](./TESTING.md) §7 — every test needs a named threat it defends against.
4. Run locally:
   ```bash
   npm run lint
   npx tsc --noEmit
   npm test
   ```
5. Open a PR against `main`. Fill in the PR template.
6. CI must be green. A maintainer will review.

## What gets merged quickly

- Bug fixes with a failing test that turns green.
- Documentation improvements.
- New tests for under-covered surfaces (see `TESTING.md` §6 for the current gap list).
- Mocked → real swaps for one of the MCP servers (`quickbooks`, `netsuite`, `square`), provided the change is self-contained to one file plus its integration helper.

## What needs design discussion first

- Changes to the policy gate (`lib/mcp/policy.ts`).
- Changes to the auth contract (`lib/auth.ts`, `lib/guard.ts`).
- Changes to the Prisma schema.
- New MCP servers (open an issue with the tool list and required RBAC capability).
- Changes to the LLM-facing tool projection (`lib/agents/hermes.ts`).

These are the load-bearing walls; we want consensus before they move.

## Code style

- TypeScript strict mode. No `any` without a comment explaining why.
- Prefer named exports. Default exports only where Next.js requires them (page/route handlers).
- Database access goes through `lib/db.ts` (Prisma). Tests use `lib/db.ts` too — never a separate Prisma client.
- Comments explain *why*, not *what*. The code already says what it does.
- Tests open with a `Why this test exists` doc-comment naming the regression they defend against.

## Commit messages

Conventional Commits, loosely:

```
feat(mcp): add quickbooks invoice.list tool
fix(auth): reject blank cookie values
docs(deployment): clarify ECS task sizing
test(rbac): pin admin > employee capability matrix
```

Body is optional but recommended for non-trivial changes — explain the *why*.

## PR checklist

- [ ] My change is focused (one logical change).
- [ ] Tests added or updated. Each new test has a `Why this test exists` comment.
- [ ] `npm run lint && npx tsc --noEmit && npm test` is green locally.
- [ ] Docs updated if I touched a documented contract (architecture, API, RBAC matrix).
- [ ] I read the section of `ARCHITECTURE.md` relevant to my change.

## Code of conduct

See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Be kind, assume good faith, focus on the code not the person.

## License

By contributing, you agree your contributions will be licensed under the MIT License (see [`LICENSE`](./LICENSE)).
