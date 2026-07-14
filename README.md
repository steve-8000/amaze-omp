# amaze-omp

A **marketplace plugin** for omp. It packages lazycodex/ultrawork's evidence-first
execution discipline and hyperplan's adversarial planning into one installable
plugin, **without modifying omp core**, and wires Plane in as durable project memory.

## What's inside

`plugins/amaze/`:

- **Chained skills** (`skills/`):
  - `amaze` — orchestrator: mode activation, LIGHT/HEAVY tier triage, the binding
    success-criteria contract, two-tier memory, and phase routing.
  - `amaze-plan` — discovery wave + optional hyperplan-lite adversarial critique,
    then delegation to omp's `plan` agent.
  - `amaze-loop` — the `PIN -> RED -> GREEN -> SURFACE -> CLEAN` execution loop with
    real manual-QA channels and paired cleanup receipts.
  - `amaze-review` — independent review (omp `review` agent for HEAVY), clean cutover,
    and Plane work-item closure with a verification summary.

  The skills chain via `read skill://amaze-plan|amaze-loop|amaze-review`; the entry
  `amaze` skill owns the contract and routes between phases.

- `tools/plane-bridge.ts` — the `plane_task_start|note|complete|lookup|block` custom
  tools. They call the Plane REST API directly (zero MCP schema cost) and persist
  task memory as work items.

- `hooks/post/amaze-status.ts` — a low-risk hook that shows Plane backend readiness
  in the footer.

## Design principles

- **No omp core changes.** A marketplace install loads the skills, hook, and tools.
- **No new subagents.** The skills orchestrate omp's existing agents (scout/plan/
  review/librarian) through the `task` tool.
- **Two-tier memory.** Plane work items for coarse, durable, human-visible milestones;
  a local notepad for fine, high-frequency working memory.
- **Lean.** lazycodex's publish/marketplace-sync CI and team-mode infrastructure are
  out of scope by design.

## Install

```
omp plugin marketplace add steve-8000/amaze-omp
omp plugin install amaze@amaze-omp
```

In a new omp session, trigger with `amaze` (or `/amaze <goal>`). Because a marketplace
install does not load `omp.extensions` modules, this plugin deliberately does not rely
on that mechanism.

## Plane environment

The `plane_task_*` tools require:

```
PLANE_API_KEY, PLANE_BASE_URL (default https://plane.example.com), PLANE_WORKSPACE_SLUG (default my-workspace)
```

## plane-bridge is the single source

This plugin owns `plane-bridge.ts`. If a native copy ever existed at
`~/.omp/agent/tools/plane-bridge.ts`, remove it — custom-tool name conflicts are
rejected (duplicate registration), so only one copy of `plane_task_*` may load.

## task_key convention

- Default: a kebab slug of the objective (`amaze-jwt-refresh`).
- On a feature branch you may prefix it (`<branch>::<slug>`).
- Reuse the same key to resume the same work item via `plane_task_lookup`.
