// amaze-status — Plane 메모리 백엔드 준비 상태를 푸터에 표시하는 저위험 훅.
//
// amaze 워크플로우는 Plane 워크아이템을 마일스톤 메모리로 쓴다(plane_task_*).
// 그 백엔드가 실제로 연결됐는지(PLANE_API_KEY/BASE_URL) 세션 시작 시 한 줄로
// 알려준다. 차단하지 않고, 툴 입출력을 건드리지 않으며, headless에서는
// setStatus가 no-op이라 안전하다.
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

export default function amazeStatus(pi: HookAPI): void {
	const planeReady = Boolean(process.env.PLANE_API_KEY && process.env.PLANE_BASE_URL);
	const text = planeReady ? "amaze \u2713 plane" : "amaze (plane env \uc5c6\uc74c)";

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("amaze", text);
	});
}
