# amaze (plugin)

Evidence-first execution workflow plus Plane project memory. See the repo-root
[README](../../README.md) for full details.

Chained skills (`read skill://<name>`):

- `amaze` — orchestrator: contract, tier triage, two-tier memory, phase routing
- `amaze-plan` — discovery + adversarial critique + delegation to the `plan` agent
- `amaze-loop` — `PIN -> RED -> GREEN -> SURFACE -> CLEAN` execution loop
- `amaze-review` — independent review + Plane completion

Plus the contract core:

- `lib/contract-core.ts` — local contract state (`.omp/amaze/<task_key>.json`);
  enforces failing-first transitions, evidence validation, and the completion verdict
  in code (tests: `bun test plugins/amaze/lib`)
- `tools/plane-bridge.ts` — `plane_task_*` + `amaze_contract_set` / `amaze_evidence` /
  `amaze_status` custom tools; `plane_task_complete` is gated on the contract
- `hooks/post/amaze-status.ts` — footer progress, deterministic compaction
  preservation, and the session-stop continuation gate (armed by the contract,
  disarmed by `plane_task_complete`/`plane_task_block`, capped at 8 by the harness)
