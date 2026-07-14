# amaze (plugin)

Evidence-first execution workflow plus Plane project memory. See the repo-root
[README](../../README.md) for full details.

Chained skills (`read skill://<name>`):

- `amaze` — orchestrator: contract, tier triage, two-tier memory, phase routing
- `amaze-plan` — discovery + adversarial critique + delegation to the `plan` agent
- `amaze-loop` — `PIN -> RED -> GREEN -> SURFACE -> CLEAN` execution loop
- `amaze-review` — independent review + Plane completion

Plus:

- `tools/plane-bridge.ts` — `plane_task_*` custom tools
- `hooks/post/amaze-status.ts` — Plane readiness footer hook
