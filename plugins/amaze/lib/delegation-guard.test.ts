// delegation-guard의 관찰 가능한 계약을 방어한다:
// task 배치 상한 초과만 차단하고, 상한 이하·다른 툴·tasks 없는 호출은 통과.
import { describe, expect, test } from "bun:test";
import delegationGuard from "../hooks/post/delegation-guard";

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

function taskEvent(count: number): Parameters<ToolCallHandler>[0] {
	return {
		toolName: "task",
		toolCallId: "t1",
		input: { tasks: Array.from({ length: count }, (_, i) => ({ task: `slice ${i}` })) },
	};
}

describe("delegation-guard", () => {
	test("배치 5개 이상은 차단하고 이유에 상한과 웨이브 지시를 담는다", () => {
		const handler = captureHandler();
		for (const n of [5, 7, 12]) {
			const result = handler(taskEvent(n));
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain(`${n}개`);
			expect(result?.reason).toContain("4");
		}
	});

	test("상한 이하 배치는 통과한다", () => {
		const handler = captureHandler();
		for (const n of [1, 2, 3, 4]) {
			expect(handler(taskEvent(n))).toBeUndefined();
		}
	});

	test("task 외 툴과 tasks 없는 입력은 건드리지 않는다", () => {
		const handler = captureHandler();
		expect(handler({ toolName: "bash", toolCallId: "t2", input: { command: "ls" } })).toBeUndefined();
		expect(handler({ toolName: "task", toolCallId: "t3", input: {} })).toBeUndefined();
		expect(handler({ toolName: "task", toolCallId: "t4", input: { tasks: "not-an-array" } })).toBeUndefined();
	});
});
