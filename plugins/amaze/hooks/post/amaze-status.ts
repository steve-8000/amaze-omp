// amaze-status — 계약 상태의 결정적 가시성/보존 훅. LLM 토큰 비용 0으로:
//
//   - session_start / turn_end: 활성 계약의 criterion 진행도를 상태바에 표시
//     (setStatus는 headless에서 no-op이라 어디서든 안전).
//   - session.compacting: 활성 계약 요약을 컴팩션 컨텍스트에 결정적으로 주입
//     — LLM 요약이 계약(성공기준/증거 경로)을 유실하는 것을 코드로 방지.
//   - session_stop: 활성 계약(enforce가 꺼져 있지 않은)에 미증명 criterion이
//     남아 있으면 continuation을 강제 주입 — 하네스가 연속 8회로 상한을 건다.
//     이탈구: plane_task_complete(needs_review 포함, 계약 마감) / plane_task_note(blocker: true)(게이트 해제).
//
// 툴 I/O를 건드리지 않는다.
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { activeContract, continuationDirective, statusLine, summarize } from "../../lib/contract-core";

export default function amazeStatus(pi: HookAPI): void {
	const planeReady = Boolean(process.env.PLANE_API_KEY && process.env.PLANE_BASE_URL);
	const planeSuffix = planeReady ? "" : " (plane env missing)";

	function refresh(ctx: { hasUI: boolean; cwd: string; ui: { setStatus(key: string, text: string): void } }): void {
		if (!ctx.hasUI) return;
		const contract = activeContract(ctx.cwd);
		const text = contract ? `amaze ${statusLine(contract)}${planeSuffix}` : `amaze${planeReady ? " \u2713 plane" : planeSuffix}`;
		ctx.ui.setStatus("amaze", text);
	}

	pi.on("session_start", async (_event, ctx) => {
		refresh(ctx);
	});
	pi.on("turn_end", async (_event, ctx) => {
		refresh(ctx);
	});
	pi.on("session.compacting", async (_event, ctx) => {
		const contract = activeContract(ctx.cwd);
		if (!contract) return;
		return { context: [summarize(contract)] };
	});
	// HookAPI 타입 표면에는 session_stop이 없지만, 훅 팩토리는 런타임에서 전체
	// ExtensionRunner 이벤트버스에 바인딩된다(실증: {continue}가 실제 동작).
	const bus = pi as unknown as {
		on(
			event: "session_stop",
			handler: (event: unknown, ctx: { cwd: string }) => Promise<{ continue: true; additionalContext: string } | undefined>,
		): void;
	};
	bus.on("session_stop", async (_event, ctx) => {
		const contract = activeContract(ctx.cwd);
		if (!contract) return undefined;
		const directive = continuationDirective(contract);
		if (!directive) return undefined;
		return { continue: true, additionalContext: directive };
	});
}
