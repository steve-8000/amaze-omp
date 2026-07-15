// delegation-guard — 위임 배치의 결정적 게이트. 프롬프트 지침이 아니라 코드로 강제:
//
//   1. task 배치 크기 > 동시 실행 상한이면 tool_call 단계에서 차단하고
//      웨이브 분할을 지시하는 교정 메시지를 돌려준다.
//   2. worker 브리프는 Target/Change/Acceptance 3섹션이 없으면 차단한다
//      — 실행 위임 계약을 정책 문구가 아니라 코드로 강제.
//
// 배경: 하네스의 task.maxConcurrency는 초과 스폰을 거부하지 않고 조용히
// 큐잉만 한다. 모델이 교정 신호를 전혀 받지 못해 7-병렬 배치가 반복 관측됨
// (세션 로그 실측: scout×5, task×7, worker×7). 큐잉된 초과분은 병렬 이득이
// 0이므로 차단이 곧 올바른 피드백이다.
//
// 상한은 ~/.omp/agent/config.yml의 task.maxConcurrency에서 읽는다(세션 시작
// 시 1회 — 하네스 설정 스냅샷과 같은 시점). 파싱 실패 시 보수적 기본값 2.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const FALLBACK_CAP = 2;

// omp config set이 기록하는 형식("  maxConcurrency: 2")만 인정하는 보수적 파서.
// config.yml 전체에서 이 키는 task 블록에만 존재한다.
export function parseCap(yml: string): number | undefined {
	const m = /^\s*maxConcurrency:\s*(\d+)\s*$/m.exec(yml);
	if (!m) return undefined;
	const n = Number(m[1]);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function configuredCap(): number {
	try {
		return parseCap(readFileSync(join(homedir(), ".omp", "agent", "config.yml"), "utf8")) ?? FALLBACK_CAP;
	} catch {
		return FALLBACK_CAP;
	}
}

const REQUIRED_WORKER_SECTIONS = ["Target", "Change", "Acceptance"] as const;

// worker 브리프에서 누락된 필수 섹션 헤딩("# Target" 등, 레벨 무관)을 돌려준다.
export function missingWorkerSections(brief: string): string[] {
	return REQUIRED_WORKER_SECTIONS.filter((s) => !new RegExp(`^#+\\s*${s}\\b`, "im").test(brief));
}

export default function delegationGuard(pi: HookAPI): void {
	const cap = configuredCap();
	pi.on("tool_call", (event) => {
		if (event.toolName !== "task") return;
		const tasks = event.input.tasks;
		if (!Array.isArray(tasks)) return;

		if (tasks.length > cap) {
			return {
				block: true,
				reason:
					`task 배치 ${tasks.length}개가 동시 실행 상한(${cap})을 초과합니다. ` +
					`초과분은 큐에서 대기만 하므로 병렬 이득이 없습니다. 가장 독립적인 ${cap}개만 먼저 스폰하고 ` +
					`결과를 받은 뒤 다음 웨이브를 보내거나, 분해 자체를 더 좁히세요.`,
			};
		}

		for (const [i, t] of tasks.entries()) {
			if (!t || typeof t !== "object" || !("agent" in t) || t.agent !== "worker") continue;
			const brief = "task" in t && typeof t.task === "string" ? t.task : "";
			const missing = missingWorkerSections(brief);
			if (missing.length > 0) {
				return {
					block: true,
					reason:
						`worker 태스크(${i + 1}번째)에 필수 섹션이 없습니다: ${missing.map((s) => `# ${s}`).join(", ")}. ` +
						`worker 브리프는 Target(파일·심볼·비목표) / Change(단계별) / Acceptance(관측 가능한 결과 + 증거 산출물) ` +
						`3섹션을 마크다운 헤딩으로 반드시 포함해야 합니다.`,
				};
			}
		}
		return;
	});
}
