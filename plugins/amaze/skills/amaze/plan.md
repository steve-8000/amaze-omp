# AMAZE — PLAN

Load this only when open design decisions remain: unclear module boundaries, several viable decompositions, or a multi-file build whose dependency order is not obvious. A known procedure, however many steps, does not need a plan phase — plan directly in the notepad and go to `skill://amaze/loop.md`.

The contract from `skill://amaze` still binds: tier, success criteria (already registered via `amaze_contract_set`), memory split, and Plane-parent-only ownership.

## Step 1 — Ensure the codegraph index, then discovery wave (parallel, lead with this)

Before any lookups: check for `.codegraph/` at the project root. Missing → run `codegraph init` there once (bash, repo root); it is idempotent, safe to re-run, and this project has standing user approval to run it automatically as part of the amaze plan phase. If init fails, is unsupported for this stack, or exceeds a reasonable timeout, fall back to grep/glob/lsp for the whole task without retrying.

Never guess from memory; locate with the right tool and re-read before you claim or change. Fire 3+ independent lookups in one action; serialize only when one output strictly feeds the next.

- `codegraph_explore` first for how/where/what/flow questions and before edits; fall back to `grep`/`glob`/`lsp` only if the index is unavailable.
- Symbols (definition/references/rename impact/diagnostics) → `lsp`, not text search.
- Structural shapes / codemods → `ast_grep` / `ast_edit`.
- Unfamiliar layout → spawn `task` with `agent: scout`, in parallel, one scout per independent area.
- External API/library/doc research → `web_search` directly, or `task` with `agent: scout` for bulk source reading.

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
  - the work is high-difficulty: the plan comes first and is completed before any
    production code; after the build, an independent review thread will judge the
    result on six aspects — requirements completeness, logical correctness, edge
    cases, code quality, test coverage, and actual execution results — so every
    task's success criteria must be checkable against those aspects.
  <paste findings + distilled insight bundle>
```

If the plan agent returns clarifying questions, forward them to the user unmodified. Do not pre-draft tasks that anchor the planner.

## High-difficulty rule — plan before code

For high-difficulty (HEAVY) work, development starts only after this plan phase is complete: constraints, decomposition, dependency order, and per-task verification are all settled first. Do not interleave planning with production edits. Bake the eventual review into the plan: the final phase dispatches an independent, read-only review thread that verifies the six aspects above and returns a fix list — a task whose success criteria cannot be judged against those aspects is under-specified; tighten it now.

## Step 4 — Record and hand off

1. Fold the returned plan into the `todo` list (one todo per atomic work unit: an edit plus its verification).
2. `plane_task_note(note = plan summary, task_key)` — persist the plan on the work item; the contract itself is already on record from Phase 1.
3. Append the plan to the notepad `## Plan`.

**Next:** `read skill://amaze/loop.md` and begin execution.
