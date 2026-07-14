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

- `lib/contract-core.ts` — the **contract core**: zero-dep local contract state at
  `.omp/amaze/<task_key>.json`. Deterministically enforces failing-first transitions
  (`pending → red → green → surfaced`; RED-less GREEN is rejected), evidence-artifact
  validation (existing, non-empty, realpath-contained in cwd/tmp/`~/.omp`), and the
  completion verdict (`isDone` is a pure function, not an LLM self-report).

- `tools/plane-bridge.ts` — custom tools, zero MCP schema cost (direct Plane REST):
  - `amaze_contract_set` — registers/updates the contract file AND find-or-creates the
    Plane work item with the contract as a start comment (absorbs `plane_task_start`);
    arms the session-stop gate by default (`enforce: false` opts out).
  - `amaze_evidence` — records red/green/surface/cleanup evidence with deterministic
    validation; no Plane round-trip, so it is free at high frequency.
  - `amaze_status` — one-call contract recovery after compaction or resume.
  - `plane_task_complete` — **gated**: rejects with an error while unproven criteria
    remain (`needs_review: true` is the only bypass); on success it closes the contract,
    disarming all hooks. `plane_task_block` also disarms the stop gate while a human
    is needed. Plus `plane_task_note|lookup`.

- `hooks/post/amaze-status.ts` — zero-token enforcement/visibility:
  criterion progress in the footer (`session_start`/`turn_end`), a deterministic
  contract summary injected into compaction context (`session.compacting`) so
  compaction can never lose the contract, and a **session-stop continuation gate**:
  while an armed contract has unproven criteria, stopping injects a continuation
  directive (the harness caps it at 8 consecutive continuations).

## Design principles

- **No omp core changes.** A marketplace install loads the skills, hook, and tools.
- **Contract as code, prompts for judgment.** Failing-first ordering, evidence
  validation, and the completion gate live in `contract-core.ts`; the skills keep only
  what needs judgment (tier triage, criteria quality, adversarial critique, review).
- **No new subagents.** The skills orchestrate omp's existing agents (scout/plan/
  review/librarian) through the `task` tool.
- **Two-tier memory.** The contract file + Plane work item for durable state;
  a local notepad for free-form findings only.
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

## Local contract state

`.omp/amaze/<task_key>.json` is per-user working state in the target repo — add
`.omp/` to that repo's `.gitignore`.

## plane-bridge is the single source

This plugin owns `plane-bridge.ts`. If a native copy ever existed at
`~/.omp/agent/tools/plane-bridge.ts`, remove it — custom-tool name conflicts are
rejected (duplicate registration), so only one copy of `plane_task_*` may load.

## task_key convention

- Default: a kebab slug of the objective (`amaze-jwt-refresh`).
- On a feature branch you may prefix it (`<branch>::<slug>`).
- Reuse the same key to resume the same work item via `plane_task_lookup`.
