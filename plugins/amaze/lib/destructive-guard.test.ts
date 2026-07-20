// destructive-guard의 관찰 가능한 계약을 방어한다:
// (1) 고신뢰 파괴적 bash 패턴 차단, (2) 안전 예외(node_modules 등) 통과,
// (3) 비-bash 툴·무관 명령은 항상 통과.
import { describe, expect, test } from "bun:test";
import destructiveGuard, { matchDestructive } from "../hooks/post/destructive-guard";

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
	destructiveGuard(fakePi as never);
	if (!handler) throw new Error("tool_call handler not registered");
	return handler;
}

function bashEvent(command: string): Parameters<ToolCallHandler>[0] {
	return { toolName: "bash", toolCallId: "t1", input: { command } };
}

describe("matchDestructive: 패턴 탐지", () => {
	test("rm -rf 절대경로를 잡는다", () => {
		expect(matchDestructive("rm -rf /var/data")).toContain("rm -rf (재귀 삭제)");
	});

	test("git reset --hard를 잡는다", () => {
		expect(matchDestructive("git reset --hard HEAD~3")).toContain("git reset --hard (커밋되지 않은 변경 유실)");
	});

	test("git push --force를 잡는다", () => {
		expect(matchDestructive("git push -f origin main")).toContain("git push --force (히스토리 재작성)");
	});

	test("DROP TABLE을 대소문자 무관하게 잡는다", () => {
		expect(matchDestructive("psql -c 'drop table users;'")).toContain("DROP TABLE/DATABASE (데이터 손실)");
	});

	test("kubectl delete를 잡는다", () => {
		expect(matchDestructive("kubectl delete pod my-pod")).toContain("kubectl delete (운영 영향)");
	});

	test("node_modules rm -rf는 안전 예외로 통과한다", () => {
		expect(matchDestructive("rm -rf node_modules dist")).toEqual([]);
	});

	test("안전 디렉터리와 위험 경로가 섞인 rm -rf는 예외 없이 잡는다", () => {
		expect(matchDestructive("rm -rf node_modules /")).toContain("rm -rf (재귀 삭제)");
	});

	test("&&로 이어진 명령은 rm 세그먼트만 검사해 안전 목록 외 커맨드는 영향 없다", () => {
		expect(matchDestructive("rm -rf dist && bun run build")).toEqual([]);
	});

	test("안전한 rm 세그먼트 뒤에 숨은 위험 rm 세그먼트도 잡는다 (멀티 세그먼트 우회 방지)", () => {
		expect(matchDestructive("rm -rf node_modules && rm -rf /")).toContain("rm -rf (재귀 삭제)");
	});

	test("트레일링 슬래시·와일드카드·롱폼 플래그도 안전 예외로 인정한다", () => {
		expect(matchDestructive("rm -rf node_modules/")).toEqual([]);
		expect(matchDestructive("rm -rf node_modules/*")).toEqual([]);
		expect(matchDestructive("rm --recursive --force node_modules")).toEqual([]);
	});

	test("플래그 뒤에 오는 git push --force도 잡는다 (인자 순서 무관)", () => {
		expect(matchDestructive("git push origin main --force")).toContain("git push --force (히스토리 재작성)");
		expect(matchDestructive("git push origin main -f")).toContain("git push --force (히스토리 재작성)");
	});

	test("--force-with-lease는 안전한 변형이라 잡지 않는다", () => {
		expect(matchDestructive("git push --force-with-lease origin main")).not.toContain("git push --force (히스토리 재작성)");
	});

	test("TABLE 키워드 없는 TRUNCATE도 잡는다", () => {
		expect(matchDestructive("psql -c 'truncate users;'")).toContain("TRUNCATE (TABLE) (데이터 손실)");
	});

	test("무관한 명령은 빈 배열을 반환한다", () => {
		expect(matchDestructive("git status")).toEqual([]);
	});
});

describe("destructiveGuard: 훅 동작", () => {
	test("파괴적 bash 명령은 block+reason을 반환한다", () => {
		const handler = captureHandler();
		const result = handler(bashEvent("git reset --hard HEAD~3"));
		expect(result?.block).toBe(true);
		expect(result?.reason).toMatch(/reset --hard/);
	});

	test("안전한 bash 명령은 통과한다", () => {
		const handler = captureHandler();
		expect(handler(bashEvent("git status"))).toBeUndefined();
	});

	test("비-bash 툴 호출은 항상 통과한다", () => {
		const handler = captureHandler();
		expect(handler({ toolName: "read", toolCallId: "t1", input: { command: "rm -rf /" } })).toBeUndefined();
	});

	test("command 필드가 없는 bash 호출은 통과한다", () => {
		const handler = captureHandler();
		expect(handler({ toolName: "bash", toolCallId: "t1", input: {} })).toBeUndefined();
	});
});
