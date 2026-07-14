---
name: amaze-plan
description: "Planning phase of the amaze workflow. Runs a parallel discovery wave, optionally an adversarial (hyperplan-lite) scout critique for contested or HEAVY design, then delegates plan formalization to omp's plan agent instead of writing the plan itself. Load with read skill://amaze-plan when open design decisions remain. Chains next to skill://amaze-loop."
---

# AMAZE — PLAN

Load this only when open design decisions remain: unclear module boundaries, several viable decompositions, or a multi-file build whose dependency order is not obvious. A known procedure, however many steps, does not need a plan phase — plan directly in the notepad and go to `skill://amaze-loop`.

The contract from `skill://amaze` still binds: tier, success criteria, two-tier memory, and Plane-parent-only ownership.

## Step 1 — Discovery wave (parallel, lead with this)

Never guess from memory; locate with the right tool and re-read before you claim or change. Fire 3+ independent lookups in one action; serialize only when one output strictly feeds the next.

- `codegraph_explore` first for how/where/what/flow questions and before edits, when a `.codegraph` index exists; otherwise `grep`/`glob`/`lsp`.
- Symbols (definition/references/rename impact/diagnostics) → `lsp`, not text search.
- Structural shapes / codemods → `ast_grep` / `ast_edit`.
- Unfamiliar layout → spawn `task` with `agent: scout`, in parallel, one scout per independent area.
- External API/library/doc research → `task` with `agent: librarian`.

Record every non-obvious fact with a `file:line` reference in the notepad `## Findings`.

## Step 2 — Adversarial critique (optional; HEAVY or contested design)

When the design is genuinely contested, pressure-test it before committing. This is hyperplan-lite: no team-mode, just parallel scouts and cross-critique.

1. Spawn `task` `agent: scout` in parallel, one per adversarial role, each producing 3-7 numbered findings (≤3 sentences each, cite file:line):
   - **skeptic** — attacks over-engineering, scope creep, premature abstraction. "Delete this; prove it is needed."
   - **validator** — attacks missed edge cases, blast radius, cross-module fragility.
   - **researcher** — demands evidence for every claim; "cite the file:line or you don't know."
   - **architect** — attacks leaky abstractions, hidden coupling, tech debt; still demands the simplest design that fits.
   - **creative** — attacks first-thought-best-thought; forces at least one lateral alternative.
2. Aggregate the findings, then dispatch a second scout round that cross-attacks the other roles' findings.
3. **You distill.** Keep only insights that were uncontested, defended with evidence, or refined stronger. Drop everything conceded. Sort survivors into: hard constraints / decisions / risks+mitigations / open questions.

Keep it proportional: a LIGHT design skips this entirely; a moderate one may use a single skeptic+validator pass.

## Step 3 — Delegate formalization to the plan agent

Do NOT write the executable plan yourself — that is the plan agent's value (sequencing, dependency order, parallelization, per-task verification).

```
task(agent: plan, run in foreground):
  Here are battle-tested insights (already discovered / adversarially filtered).
  Produce an executable plan. Rules:
  - respect every hard constraint,
  - weave each risk's mitigation into the relevant task,
  - surface each open question as a user-input gate before dependent tasks,
  - give every task explicit success criteria and verification.
  <paste findings + distilled insight bundle>
```

If the plan agent returns clarifying questions, forward them to the user unmodified. Do not pre-draft tasks that anchor the planner.

## Step 4 — Record and hand off

1. Fold the returned plan into the `todo` list (one todo per atomic work unit: an edit plus its verification).
2. `plane_task_note(note = plan summary, task_key)` — persist the plan on the work item.
3. Append the plan to the notepad `## Plan`.

**Next:** `read skill://amaze-loop` and begin execution.
