---
name: amaze-loop
description: "Execution phase of the amaze workflow. Drives every success criterion through PIN -> RED -> GREEN -> SURFACE -> CLEAN with tier-sized evidence and real manual-QA channels (bash/launch/browser/debug), plus paired cleanup receipts. Load with read skill://amaze-loop after the contract (and planning, if any) is set. Chains next to skill://amaze-review."
---

# AMAZE — LOOP

Execute until every success criterion PASSES with its evidence captured. The contract from `skill://amaze` binds: tier, criteria, two-tier memory, Plane-parent-only ownership.

## The loop, per criterion

Run this for each criterion; batch independent reads/searches/subagents within a step, but never parallelize RED and GREEN of the same criterion.

1. **PICK** — mark the todo `in_progress`; update notepad `## Now`.
2. **PIN + RED** — if you touch existing behavior, first pin it with a characterization test that passes on the unchanged code. Then capture the failing-first proof through the cheapest faithful channel:
   - a unit test where a seam exists,
   - an integration/e2e test where the behavior lives in wiring,
   - the criterion's real-surface scenario captured failing when no test seam exists.
   It must fail for the RIGHT reason (not a syntax/import error). Paste RED output into the notepad. No production code yet.
3. **GREEN** — write the smallest production change that flips RED→GREEN. Re-run; capture GREEN. If GREEN is far larger than the criterion implies, the proof was too coarse — split it.
4. **SURFACE** — run the real-surface proof the criterion named, end to end, yourself (channel table below). If the RED proof was the scenario itself, re-run it passing. Paste the artifact path into the notepad.
5. **CLEAN** — tear down every runtime artifact this criterion's QA spawned, then write a one-line receipt.
6. **VERIFY** — `lsp` diagnostics clean on changed files; related tests green (no skipped/xfail added this turn).
7. **CLOSE** — mark the todo done; append findings/learnings. Re-run every criterion's scenario after each increment.

## Manual-QA channels (SURFACE)

Prove it through the channel that faithfully exercises the surface; capture the artifact. `--dry-run`, "should work", and "looks correct" never count.

| Surface | Tool | Evidence |
|---|---|---|
| HTTP endpoint | `bash` `curl -i` (or Playwright APIRequestContext) | status line + headers + body |
| Service / TUI | `launch` (real pty) | boot log + driven interaction |
| Real web page | `browser` (real clicks/typing/observe) | action log + screenshot |
| Desktop / GUI | `debug` or computer-use | action log + screenshot |
| CLI- or data-shaped | `bash` | stdout / DB-state diff / parsed config dump (first-class evidence) |

For every scenario, name the exact invocation up front (the literal command / API call / page action with concrete inputs) and the single binary observable that decides PASS vs FAIL.

## Prose-target rule

For a prose change (prompt, SKILL.md, rule, markdown) the wording is not behavior. Never pin sentences, phrase presence/absence, or word counts. Pin only a machine-consumed value (a parsed frontmatter field, a sentinel token a hook greps, a JSON sample through its real validator) or one `toBe` equality between two shipped copies. A pure-prose change with no machine consumer has no seam: ship it on review + QA-by-read, with no test — a text grep is pretend-coverage.

## Cleanup receipts (paired, never skipped)

The moment a QA scenario spawns a resource, register its teardown as its own todo. Before the criterion completes, tear down and record a receipt next to the artifact:

- server PIDs → `kill <pid>`; verify `kill -0` fails
- `launch` processes → `launch stop`
- browser / Playwright contexts → `.close()`
- containers → `docker rm -f`; bound ports → `lsof -i :<port>` empty
- temp files/dirs → `rm -rf` the `mktemp` paths; QA-only env vars unset

No receipt → the criterion stays `in_progress`.

## Plane checkpoints (sparingly)

- At a meaningful phase boundary: `plane_task_note(note, task_key)`.
- On a blocker: `plane_task_block(reason, task_key)` — surfaces it for a human without changing the item's state.
- Everything high-frequency (each RED/GREEN, each finding) goes to the local notepad, not Plane.

## Delegation

Non-importing file edits and independent subsystem changes can go to parallel `task` workers with tight scope, each told to skip formatters/linters/full-suite runs (you run those once at the end). You own the plan, integration, and final verification.

**Next:** when every criterion PASSES with evidence, `read skill://amaze-review`.
