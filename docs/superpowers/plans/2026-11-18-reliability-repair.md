# Learning feed reliability repair implementation plan

> **For agentic workers:** Use subagent-driven-development to implement independent tasks and verification-before-completion before reporting success.

**Goal:** Restore useful learning output, compensate for missed scheduled invocations, and recover failed content with a durable audit trail.

**Architecture:** Keep the current Next.js/Neon/GitHub Actions deployment. Constrain model output and permit a single source-grounded revision before full publication validation and independent factual audit. Replace event-specific cron routing with an hourly persistent due-stage dispatcher and expiring stage leases. Recover affected failures once for the new generation revision, retaining previous attempts and errors.

**Tech stack:** Existing TypeScript, Node.js, Neon serverless and public GitHub Actions; no new dependency or paid infrastructure.

**Spec:** User-approved verification and repair of the confirmed November 18 generation/backlog/scheduling failures in this chat.

## Constraints

- Preserve existing articles, raw release records, bookmarks and source links.
- Never publish without full article validation and independent factual audit.
- Keep API keys and raw diagnostics private; no third-party repository code execution.
- No new test files or dependencies. Use bounded inline checks, real source/model smoke runs, typecheck, lint and build.
- A missed GitHub wakeup cannot be guaranteed away; subsequent invocations must detect due work from durable state.
- Recovery must retain the original failure state, exclude missing-source tasks and active leases, and be idempotent per content and repair revision.

## Tasks

- [x] AI worker: reproduce current output failures using actual release/digest evidence; improve output contract and add at most one source-grounded correction, with capped output/time/call count and final unchanged publication gates.
- [x] Scheduler worker: hourly wakeup, persistent due stages, expiring/renewed stage leases, bounded children, preserved manual dispatch, read-only preview.
- [x] Root: additive lease/recovery schema; prioritize first publication over existing-article refresh; avoid enqueuing more automatic deep/refresh work when the learning queue already has work.
- [x] Root: versioned recovery CLI with dry-run and durable old-state records, applied only after real repaired generation succeeds.
- [x] Review: race handling, retry idempotency, call/time budgets, audit boundaries and credential handling.
- [ ] Validate migrations twice, dry-run scheduler, scope of recovery, true release/digest publication, full required checks and production deployment.

## Ownership

- AI worker: src/lib/ai.ts and up to two focused helper modules.
- Scheduler worker: .github/workflows/collect.yml, scripts/scheduled-collect.ts, src/lib/scheduler.ts.
- Root: db/schema.sql, src/lib/store.ts, scripts/collect.ts and a scoped private recovery helper/CLI; documentation after verification.

## Review focus

- Model structural repair must not bypass factual rejection or silently fabricate absent changes.
- Exhausted/source-paused items must not be repeatedly reset by ordinary cron runs.
- Expired leases may be reclaimed; a lease owner must not release another owner's lease.
- Infrastructure errors must not cause unbounded repeated paid calls.
- Manual repository smoke runs must not falsely advance global schedule watermarks.
