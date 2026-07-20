# amaze (plugin)

Evidence-first execution workflow plus Plane project memory. See the repo-root
[README](../../README.md) for full details.

Chained skills (`read skill://<name>`):

- `amaze` — orchestrator: contract, tier triage, two-tier memory, phase routing
- `amaze/plan.md` — discovery + adversarial critique + delegation to the `plan` agent
- `amaze/loop.md` — `PIN -> RED -> GREEN -> SURFACE -> CLEAN` execution loop
- `amaze/review.md` — independent review + Plane completion

Plus the contract core:

- `lib/contract-core.ts` — local contract state (`.omp/amaze/<task_key>.json`);
  enforces failing-first transitions, evidence validation, and the completion verdict
  in code; snapshots the prior version to `.omp/amaze/.history/` on every save
  (latest 10 per task_key) (tests: `bun test plugins/amaze/lib`)
- `tools/plane-bridge.ts` — `plane_task_*` + `amaze_contract_set` / `amaze_evidence` /
  `amaze_status` custom tools; `plane_task_complete` is gated on the contract;
  `redactScan()` strips high-confidence secrets before any Plane write
- `hooks/post/amaze-status.ts` — footer progress, deterministic compaction
  preservation, and the session-stop continuation gate (armed by the contract,
  disarmed by `plane_task_complete`/`plane_task_note(blocker: true)`, capped at 8 by the harness)
- `hooks/post/destructive-guard.ts` — blocks `bash` calls matching high-confidence
  destructive patterns (`rm -rf`, `git reset --hard`, force-push, `DROP TABLE`,
  `kubectl delete`, …), with build-output directories exempted
