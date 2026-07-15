// delegation-guard의 관찰 가능한 계약을 방어한다:
// (1) config 기반 상한 초과 배치 차단, (2) worker 브리프 3섹션 강제,
// (3) 상한 이하·다른 툴·tasks 없는 호출은 통과, (4) cap 파서의 경계.
import { describe, expect, test } from "bun:test";
import delegationGuard, { configuredCap, missingWorkerSections, parseCap } from "../hooks/post/delegation-guard";

type ToolCallHandler = (event: {
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}) => { block?: boolean; reason?: string } | undefined;

function captureHandler(): ToolCallHandler {
	let handler: ToolCallHandler | undefined;
	const fakePi = {
		on(eventName: string, fn: ToolCallHandler) {
			if (eventName === "tool_call") handler = fn;
		},
	};
	// HookAPI 표면 중 이 훅이 쓰는 건 on()뿐이다 — 최소 페이크로 실제 팩토리를 구동.
	delegationGuard(fakePi as never);
	if (!handler) throw new Error("tool_call handler not registered");
	return handler;
}

const VALID_BRIEF = "# Target\nfile x\n# Change\n1. do y\n# Acceptance\nlog at /tmp/z.log";

function taskEvent(count: number, agent = "sonic", brief = "reply OK"): Parameters<ToolCallHandler>[0] {
	return {
		toolName: "task",
		toolCallId: "t1",
		input: { tasks: Array.from({ length: count }, () => ({ agent, task: brief })) },
	};
}

// 훅과 동일한 소스(config.yml)에서 상한을 읽어 기대값을 세운다 —
// 사용자가 task.maxConcurrency를 바꿔도 테스트가 계약을 따라간다.
const cap = configuredCap();

describe("delegation-guard: 배치 상한", () => {
	test("상한 초과 배치는 차단하고 이유에 상한과 웨이브 지시를 담는다", () => {
		const handler = captureHandler();
		for (const n of [cap + 1, cap + 3, cap + 10]) {
			const result = handler(taskEvent(n));
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain(`${n}개`);
			expect(result?.reason).toContain(`상한(${cap})`);
		}
	});

	test("상한 이하 배치는 통과한다", () => {
		const handler = captureHandler();
		for (let n = 1; n <= cap; n++) {
			expect(handler(taskEvent(n))).toBeUndefined();
		}
	});
});

describe("delegation-guard: worker 브리프 계약", () => {
	test("3섹션 없는 worker 태스크는 차단하고 누락 섹션을 명시한다", () => {
		const handler = captureHandler();
		const result = handler(taskEvent(1, "worker", "just fix the bug"));
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("# Target");
		expect(result?.reason).toContain("# Change");
		expect(result?.reason).toContain("# Acceptance");
	});

	test("일부 섹션만 있으면 누락분만 보고한다", () => {
		const missing = missingWorkerSections("# Target\nx\n## Acceptance\ny");
		expect(missing).toEqual(["Change"]);
	});

	test("3섹션을 갖춘 worker 태스크는 통과한다 (헤딩 레벨 무관)", () => {
		const handler = captureHandler();
		expect(handler(taskEvent(1, "worker", VALID_BRIEF))).toBeUndefined();
		expect(handler(taskEvent(1, "worker", VALID_BRIEF.replaceAll("# ", "## ")))).toBeUndefined();
	});

	test("worker 외 에이전트는 섹션 없이도 통과한다", () => {
		const handler = captureHandler();
		expect(handler(taskEvent(1, "scout", "find all callers of foo"))).toBeUndefined();
	});
});

describe("delegation-guard: 무관 입력", () => {
	test("task 외 툴과 tasks 없는 입력은 건드리지 않는다", () => {
		const handler = captureHandler();
		expect(handler({ toolName: "bash", toolCallId: "t2", input: { command: "ls" } })).toBeUndefined();
		expect(handler({ toolName: "task", toolCallId: "t3", input: {} })).toBeUndefined();
		expect(handler({ toolName: "task", toolCallId: "t4", input: { tasks: "not-an-array" } })).toBeUndefined();
	});
});

describe("parseCap", () => {
	test("omp config set 형식을 파싱한다", () => {
		expect(parseCap("task: \n  maxConcurrency: 3\n")).toBe(3);
	});

	test("키 부재·비정상 값은 undefined", () => {
		expect(parseCap("")).toBeUndefined();
		expect(parseCap("task:\n  maxConcurrency: 0\n")).toBeUndefined();
		expect(parseCap("task:\n  maxConcurrency: abc\n")).toBeUndefined();
	});
});
