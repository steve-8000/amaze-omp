# AMAZE — REVIEW & COMPLETE

The final phase. Completion is declared only here. The contract from `skill://amaze` binds: tier, criteria, memory split, Plane-parent-only ownership.

## Step 1 — Gate

Call `amaze_status(task_key)` to confirm EVERY criterion PASSES with its evidence and cleanup receipt. If any is unproven, return to `skill://amaze/loop.md` — do not paper over it here; `plane_task_complete` refuses to close while a criterion lacks evidence (a code gate; only `needs_review: true` bypasses it).

Re-run each criterion's scenario once more and confirm PASS inline with the evidence paths.

## Step 2 — Independent review thread

- **HEAVY** → dispatch an independent review thread: `task` `agent: review`, given the change set, the original requirements, the success criteria, and the evidence artifacts. Do not self-certify HEAVY work.
- **LIGHT** → self-review recorded in the notepad, walking the same six aspects below against each criterion, its evidence, and the diff from the user's perspective. Confirm every changed line traces to the request.

### Reviewer contract (binding for the review thread)

The reviewer NEVER edits code — read-only verification, and verification against exactly these six aspects, nothing else:

1. **Requirements completeness** — every asked-for deliverable exists; no silent scope shrink; nothing extra smuggled in; explicitly deferred scope recorded in the notepad is not a completeness finding.
2. **Logical correctness** — the implementation actually does what the criteria claim; control/data flow holds under scrutiny; behavior inherited unchanged from surrounding code is not a correctness finding of this diff.
3. **Edge cases** — boundary, empty, malformed, concurrent, and failure inputs behave sanely; a speculative edge case with no reachable input path is not a finding.
4. **Code quality** — dead code, leftover scaffolding, duplicated conventions, naming, maintainability for the next reader; pre-existing debt outside this diff is not a finding.
5. **Test coverage** — each changed contract is defended by a test that would fail on a plausible bug; no pretend-coverage; absence of tests for unchanged contracts is not a finding.
6. **Actual execution results** — the captured RED/GREEN/SURFACE evidence is real, recent, and matches the claims; re-run scenarios where cheap; a flaky or environment-specific failure unrelated to the diff is not a finding here.

### Fix-list protocol (iterate until pass)

1. The reviewer submits its findings to the main thread as a **numbered fix list**: each item names the aspect violated, severity, `file:line`, expected vs actual. No prose verdicts without items; no code edits.
2. The main thread fixes: `read skill://amaze/loop.md` § Fix-list intake — fold items into todos, fix with loop discipline, capture evidence.
3. Re-dispatch the SAME review scope for re-verification on the updated diff plus the previous fix list (re-review may focus on the fixed diff, but any aspect regression is in scope).
4. Repeat 1-3 until the reviewer returns **unconditional PASS on all six aspects** — or an item is genuinely stuck, in which case stop iterating and report precisely where it is blocked: the item, what was tried, and what is missing. Never declare done with an open fix list.

Reviewers are read-only reporters — they never touch Plane. You record their outcome; for a `proof: review` criterion, save the verdict to a file and log it via `amaze_evidence(kind: surface, artifact_path)`.

## Step 3 — Clean cutover

- Remove scaffolding, dead code, debug prints, and any temporary shims this work introduced. Migrate every caller; leave no aliases, re-exports, or deprecated paths.
- Confirm `lsp` diagnostics are clean on all changed files and the related test suite is green (no skipped/xfail added this run).
- Finalize the notepad `## Learnings` with non-obvious patterns and pitfalls; any decision made along the way that wasn't forced by the ask gets a `[DECISION] <choice> — <one-line rationale>` line so it doesn't get silently re-litigated or re-added later.
- If the repo has a CHANGELOG, the new entry answers what changed / why it matters / how to use it — fewer than two of those three answered means rewrite it; change it with an exact-match, in-place edit, never a wholesale regenerate/overwrite.

## Step 4 — Close the work item

1. `plane_task_complete(summary, task_key, needs_review?)` where the summary states what changed (files/modules) and how it was verified (the scenarios run and their evidence). The tool re-checks the contract and errors if any criterion still lacks evidence.
   - Fully done and approved → omit `needs_review` (moves to completed).
   - Still awaiting human review → `needs_review: true` (stays in progress, flagged for review).
2. The tool reads the work item back; confirm the state landed. Report the identifier, final state, and the verification summary.

## Definition of done

- Every requested deliverable is complete; no partial work presented as complete.
- Every affected artifact — callsites, tests, docs — is updated or intentionally left unchanged.
- The user-facing behavior is proven end to end by captured evidence, not by a green suite alone.
- The Plane work item is closed with a verification summary, and the notepad reflects the final state.
