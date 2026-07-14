// amaze-status — low-risk hook that surfaces Plane memory-backend readiness in the footer.
//
// The amaze workflow uses Plane work items as milestone memory (plane_task_*).
// This hook reports, once per session, whether that backend is actually wired
// (PLANE_API_KEY / PLANE_BASE_URL). It never blocks, never touches tool I/O, and
// setStatus is a no-op in headless mode, so it is safe everywhere.
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

export default function amazeStatus(pi: HookAPI): void {
	const planeReady = Boolean(process.env.PLANE_API_KEY && process.env.PLANE_BASE_URL);
	const text = planeReady ? "amaze \u2713 plane" : "amaze (plane env missing)";

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("amaze", text);
	});
}
