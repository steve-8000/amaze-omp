---
name: amaze
description: "Evidence-first execution workflow orchestrator for omp. Classifies the change (LIGHT/HEAVY), registers a binding success-criteria contract, keeps two-tier memory (a Plane work item plus a local notepad), and routes each phase to the chained sub-skills amaze-plan, amaze-loop, and amaze-review. Reuses existing omp subagents (scout/plan/review/librarian) through the task tool and defines no new agents. Triggers: amaze, /amaze, ultrawork, 'evidence-based', 'prove it works end to end', 'plan then build then review', 'ship it verified'."
---

# AMAZE

**MANDATORY**: the first user-visible line this turn is exactly `AMAZE MODE ENABLED!`.

Deliver exactly what was asked, working end to end, proven by captured evidence. A green test suite means a unit-level contract holds — it never proves the user-facing behavior works. You are done only when every success criterion PASSES with its evidence captured.

## Phase map

```mermaid
graph LR
  A[0 Activate + resume] --> B[1 Contract: tier + criteria + memory]
  B --> C{open design decisions?}
  C -- yes --> P[2 Plan: skill://amaze-plan]
  C -- no --> L[3 Execute: skill://amaze-loop]
  P --> L
  L --> R[4 Review + complete: skill://amaze-review]
```

This skill owns Phases 0-1 and the routing. Each later phase lives in a chained skill you load on demand with the `read` tool:

- **Phase 2 — Plan** → `read skill://amaze-plan` (only when open design decisions remain).
- **Phase 3 — Execute** → `read skill://amaze-loop`.
- **Phase 4 — Review & complete** → `read skill://amaze-review`.

Load each sub-skill when its phase begins and follow it literally. The contract below (tier, criteria, memory, ownership) binds every phase.

## Non-negotiables

- **No new subagents.** omp's `scout`/`plan`/`review`/`reviewer`/`librarian`/`designer`/`sonic`/`task` are the roster. Orchestrate them with the `task` tool; never define a new agent.
- **No omp core or config changes.** This workflow runs entirely on this skill set plus existing tools.
- **Plane mutation is parent-orchestrator only.** Subagents report findings; the parent records them to Plane. Never let a subagent call `plane_task_*`.
- **Failing-first evidence is the contract.** Every criterion is captured RED before the fix and GREEN after. Evidence added after the green code does not count.

## Phase 0 — Activate and resume

1. Print `AMAZE MODE ENABLED!` once.
2. Restate the request in one sentence.
3. Call `plane_task_lookup` to see whether this repo already tracks the task. If resuming, read the work item's comment history as memory, and re-read the local notepad if present, before planning anything new.

## Phase 1 — The contract

### Tier triage (classify once, ratchet up only)

Judge by what THIS session will itself edit or execute; delegated work is payload and does not raise your tier.

- **LIGHT** (default): a known pattern with no open design decisions — one-spot bugfix, an endpoint following an existing pattern, a validation rule, a query tweak, copy/constants, or launching/steering another session.
- **HEAVY** (any one fact forces it): a new module/layer/domain model/abstraction; auth, security, session, or permission code; building or changing an external integration (API/queue/payment/webhook); a DB schema or migration; concurrency, transaction boundaries, or cache invalidation; a refactor crossing domain boundaries; or the user asked for care ("carefully", "thoroughly", "design first") or a review of this session's work.

When unsure, take HEAVY. If a HEAVY fact surfaces mid-task, upgrade immediately and redo whatever LIGHT skipped. Never downgrade. Record the tier and a one-line justification in the notepad.

### Register the binding goal

1. `plane_task_start(task = objective + success criteria, task_key)` — the work item is the durable, human-visible contract for this run.
2. `todo init` — the live checklist; exactly one item `in_progress` at a time.
3. Each criterion names an **exact scenario**: the literal command / page action / payload, the binary PASS/FAIL observable, and the evidence artifact path it will capture. LIGHT: 1-2 criteria (happy path + the riskiest edge). HEAVY: 3+ (happy; edges — boundary/empty/malformed/concurrent; and an adjacent-surface regression named by file + function).
4. For each criterion, name the failing-first proof (test id or scenario) captured RED before implementation and GREEN after.

### task_key convention

- Default: a short kebab slug of the objective — `amaze-jwt-refresh`, `fix-login-race`.
- On a feature branch you may prefix it — `<branch>::<slug>`.
- Keep it stable and human-readable so `plane_task_lookup` finds it. Resuming the same work uses the same key and continues the same work item.

## Two-tier memory

A Plane sync is a multi-call read-first + write-back sequence, not a free status flip. So split memory by cost:

| Layer | Store | Holds | Cadence |
|---|---|---|---|
| Coarse milestones (durable, human-visible, cross-session) | **Plane work item** (`plane_task_*`) | goal + criteria, phase boundaries, blockers, completion + verification evidence | 2-4 calls per task |
| Fine working memory (zero-latency, high-frequency) | **local notepad** `local://amaze-<task_key>.md` | findings, RED/GREEN captures, QA artifact paths, Now/Todo | append every step |

Notepad sections: `Plan` / `Success criteria` / `Now` / `Todo` / `Findings` / `Learnings`. Append-only. After any context loss (compaction), re-read the whole notepad first, then resume from `## Now`.

## Routing

- Open design decisions remain (unclear module boundaries, several viable decompositions, non-obvious dependency order) → `read skill://amaze-plan`. Otherwise skip to execution.
- Ready to build → `read skill://amaze-loop`.
- All criteria pass → `read skill://amaze-review` before declaring done.

Each sub-skill ends by pointing to the next phase. Do not declare completion outside `amaze-review`.
