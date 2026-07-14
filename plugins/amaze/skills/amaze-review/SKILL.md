---
name: amaze-review
description: "Review and completion phase of the amaze workflow. Gates on every success criterion passing with captured evidence, runs an independent omp review agent to unconditional approval for HEAVY work, removes scaffolding, then closes the Plane work item with a verification summary. Load with read skill://amaze-review before declaring done. Final phase of the amaze chain."
---

# AMAZE — REVIEW & COMPLETE

The final phase. Completion is declared only here. The contract from `skill://amaze` binds: tier, criteria, two-tier memory, Plane-parent-only ownership.

## Step 1 — Gate

Do not proceed until EVERY success criterion PASSES with its evidence artifact captured and its cleanup receipt recorded. If any criterion is unproven, return to `skill://amaze-loop` — do not paper over it here.

Re-run each criterion's scenario once more and confirm PASS inline with the evidence paths.

## Step 2 — Review

- **HEAVY** → dispatch an independent `task` `agent: review` (or `reviewer`). Give it the change set, the success criteria, and the evidence. Fix what it raises and re-review; loop until unconditional approval. Do not self-certify HEAVY work.
- **LIGHT** → self-review recorded in the notepad: walk each criterion, its evidence, and the diff from the user's perspective. Confirm every changed line traces to the request.

Reviewers are read-only reporters — they never touch Plane. You record their outcome.

## Step 3 — Clean cutover

- Remove scaffolding, dead code, debug prints, and any temporary shims this work introduced. Migrate every caller; leave no aliases, re-exports, or deprecated paths.
- Confirm `lsp` diagnostics are clean on all changed files and the related test suite is green (no skipped/xfail added this run).
- Finalize the notepad `## Learnings` with non-obvious patterns and pitfalls.

## Step 4 — Close the work item

1. `plane_task_complete(summary, task_key, needs_review?)` where the summary states what changed (files/modules) and how it was verified (the scenarios run and their evidence).
   - Fully done and approved → omit `needs_review` (moves to completed).
   - Still awaiting human review → `needs_review: true` (stays in progress, flagged for review).
2. The tool reads the work item back; confirm the state landed. Report the identifier, final state, and the verification summary.

## Definition of done

- Every requested deliverable is complete; no partial work presented as complete.
- Every affected artifact — callsites, tests, docs — is updated or intentionally left unchanged.
- The user-facing behavior is proven end to end by captured evidence, not by a green suite alone.
- The Plane work item is closed with a verification summary, and the notepad reflects the final state.
