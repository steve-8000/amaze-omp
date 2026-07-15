// delegation-guard — 위임 배치의 결정적 게이트. 프롬프트 지침이 아니라 코드로 강제:
//
//   - task 배치 크기 > MAX_PARALLEL_TASKS면 tool_call 단계에서 차단하고
//     웨이브 분할을 지시하는 교정 메시지를 돌려준다.
//
// 배경: 하네스의 task.maxConcurrency(=4)는 초과 스폰을 거부하지 않고 조용히
// 큐잉만 한다. 모델이 교정 신호를 전혀 받지 못해 7-병렬 배치가 반복 관측됨
// (세션 로그 실측: scout×5, task×7, worker×7). 큐잉된 초과분은 병렬 이득이
// 0이므로 차단이 곧 올바른 피드백이다.
//
// MAX_PARALLEL_TASKS는 config.yml의 task.maxConcurrency와 일치시켜 유지한다.
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const MAX_PARALLEL_TASKS = 4;

export default function delegationGuard(pi: HookAPI): void {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "task") return;
		const tasks = event.input.tasks;
		if (!Array.isArray(tasks) || tasks.length <= MAX_PARALLEL_TASKS) return;
		return {
			block: true,
			reason:
				`task 배치 ${tasks.length}개가 동시 실행 상한(${MAX_PARALLEL_TASKS})을 초과합니다. ` +
				`초과분은 큐에서 대기만 하므로 병렬 이득이 없습니다. 가장 독립적인 ${MAX_PARALLEL_TASKS}개만 먼저 스폰하고 ` +
				`결과를 받은 뒤 다음 웨이브를 보내거나, 분해 자체를 더 좁히세요.`,
		};
	});
}
