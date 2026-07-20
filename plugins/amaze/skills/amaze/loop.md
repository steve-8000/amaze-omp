# AMAZE — LOOP

Execute until every success criterion PASSES with its evidence captured. The contract from `skill://amaze` binds: tier, criteria, memory split, Plane-parent-only ownership.

## The loop, per criterion

Run this for each criterion; batch independent reads/searches/subagents within a step, but never parallelize RED and GREEN of the same criterion.

1. **PICK** — mark the todo `in_progress`; update notepad `## Now`.
2. **PIN + RED** — if you touch existing behavior, first pin it with a characterization test that passes on the unchanged code. Then capture the failing-first proof through the cheapest faithful channel:
   - a unit test where a seam exists,
   - an integration/e2e test where the behavior lives in wiring,
   - the criterion's real-surface scenario captured failing when no test seam exists.
   It must fail for the RIGHT reason (not a syntax/import error). Save the output to a file, then `amaze_evidence(task_key, criterion_id, kind: red, artifact_path)`. No production code yet.
3. **GREEN** — write the smallest production change that flips RED→GREEN. Re-run, save the output, `amaze_evidence(kind: green, artifact_path)` — the tool rejects GREEN without a prior RED, so failing-first order is enforced in code. If GREEN is far larger than the criterion implies, the proof was too coarse — split it.
4. **SURFACE** — run the real-surface proof the criterion named, end to end, yourself (channel table below). If the RED proof was the scenario itself, re-run it passing. `amaze_evidence(kind: surface, artifact_path)`.
5. **CLEAN** — tear down every runtime artifact this criterion's QA spawned, then `amaze_evidence(kind: cleanup, note)`.
6. **VERIFY** — `lsp` diagnostics clean on changed files; related tests green (no skipped/xfail added this turn).
7. **CLOSE** — mark the todo done; append findings/learnings. Record any non-obvious design/scope choice as `[DECISION] <choice> — <one-line rationale>` so a later reader can tell what was decided on purpose versus what just happened. Re-run every criterion's scenario after each increment.

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

For a prose change (prompt, SKILL.md, rule, markdown) the wording is not behavior. Never pin sentences, phrase presence/absence, or word counts. Pin only a machine-consumed value (a parsed frontmatter field, a sentinel token a hook greps, a JSON sample through its real validator) or one `toBe` equality between two shipped copies. A pure-prose change with no machine consumer has no seam: give it a `proof: review` criterion and ship it on review + QA-by-read — a text grep is pretend-coverage.

## Cleanup receipts (paired, never skipped)

The moment a QA scenario spawns a resource, register its teardown as its own todo. Before the criterion completes, tear down and record the receipt via `amaze_evidence(kind: cleanup, note)`:

- server PIDs → `kill <pid>`; verify `kill -0` fails
- `launch` processes → `launch stop`
- browser / Playwright contexts → `.close()`
- containers → `docker rm -f`; bound ports → `lsof -i :<port>` empty
- temp files/dirs → `rm -rf` the `mktemp` paths; QA-only env vars unset

No receipt → the criterion stays `in_progress`.

## Plane checkpoints (sparingly)

- At a meaningful phase boundary: `plane_task_note(note, task_key)`.
- On a blocker: `plane_task_note(note, task_key, blocker: true)` — surfaces it for a human without changing the item's state, and disarms the session-stop gate so you aren't nagged while waiting (re-arm by re-running `amaze_contract_set`).
- Findings and learnings go to the local notepad; RED/GREEN/SURFACE/CLEAN evidence goes to `amaze_evidence`, not Plane.

## Delegation

Delegate only when the overhead is worth it: single-file, known-pattern, or small (~<50-line-diff) changes are done and checked by you directly — no spawn, no review round-trip. Real independent slices go to parallel `worker` subagents with tight scope, **at most 2 per batch** (the concurrency cap; the delegation-guard hook blocks larger batches — split into waves). Each brief carries Target/Change/Acceptance sections, demands evidence artifacts (saved log/test-output paths, not narrative claims), and forbids formatters/linters/full-suite runs (you run those once at the end). For long-running slices, include the Plane `project_id` + `work_item_id` in the brief so the worker can post checkpoint comments via `plane_progress_note`; workers never call any other Plane or amaze tool. Route `review` (opus) once at integration time over HEAVY or multi-slice worker output — not per slice, and not for LIGHT single slices you can verify yourself. You own the plan, integration, and final verification.

## Fix-list intake (re-entry from review)

The review phase runs in an independent, read-only thread and never edits code — every fix lands here, in the main thread. When review returns a numbered fix list:

1. Fold each fix item into the `todo` list as its own item, keeping the reviewer's numbering, severity, and `file:line` reference.
2. Fix each item through the same loop discipline above — a behavior fix gets its RED→GREEN→SURFACE evidence like any criterion; a pure code-quality fix gets diagnostics-clean + related-tests-green.
3. Never argue a finding away silently: fix it, or record a one-line rebuttal with evidence in the notepad for the reviewer to re-judge.
4. When the list is exhausted, return to `skill://amaze/review.md` for re-verification. Iterate until the review passes — or, if genuinely stuck on an item, record exactly where and why (what was tried, what is missing) and surface it instead of papering over.

**Next:** when every criterion PASSES with evidence, `read skill://amaze/review.md`.
