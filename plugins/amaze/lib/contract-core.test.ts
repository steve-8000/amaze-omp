// contract-core의 관찰 가능한 계약을 방어한다:
// 전이 규칙(failing-first), 완료 판정, 아티팩트 containment, 원자적 저장/로드.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	activeContract,
	applyEvidence,
	continuationDirective,
	isDone,
	listContracts,
	loadContract,
	newContract,
	saveContract,
	statusLine,
	unproven,
	upsertCriteria,
	validateArtifact,
} from "./contract-core";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "amaze-core-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function makeContract() {
	const contract = newContract("fix-login", "로그인 레이스 수정", "HEAVY");
	upsertCriteria(contract, [
		{ id: "c1", scenario: "curl -i /login 동시 2회", observable: "둘 다 200" },
		{ id: "c2", scenario: "SKILL.md 리뷰", observable: "리뷰 승인", proof: "review" },
	]);
	return contract;
}

describe("전이 규칙 (failing-first)", () => {
	test("RED 없이 GREEN은 거부된다", () => {
		const c = makeContract();
		expect(() => applyEvidence(c, "c1", { kind: "green", note: "통과" })).toThrow(/failing-first/);
	});

	test("pending→red→green→surfaced 정상 경로", () => {
		const c = makeContract();
		applyEvidence(c, "c1", { kind: "red", note: "500 응답 캡처" });
		expect(c.criteria[0].status).toBe("red");
		applyEvidence(c, "c1", { kind: "green", note: "200 응답" });
		expect(c.criteria[0].status).toBe("green");
		applyEvidence(c, "c1", { kind: "surface", note: "실서피스 재실행" });
		expect(c.criteria[0].status).toBe("surfaced");
	});

	test("GREEN 이후 RED 재작성은 거부된다 (failing-first 위조 방지)", () => {
		const c = makeContract();
		applyEvidence(c, "c1", { kind: "red", note: "r" });
		applyEvidence(c, "c1", { kind: "green", note: "g" });
		expect(() => applyEvidence(c, "c1", { kind: "red", note: "위조" })).toThrow(/pending/);
	});

	test("GREEN 전 SURFACE는 거부된다", () => {
		const c = makeContract();
		expect(() => applyEvidence(c, "c1", { kind: "surface", note: "s" })).toThrow(/GREEN 이후/);
	});

	test("proof=review는 surface 직행 허용, green은 거부", () => {
		const c = makeContract();
		applyEvidence(c, "c2", { kind: "surface", note: "리뷰 승인 기록" });
		expect(c.criteria[1].status).toBe("surfaced");
		const c2 = makeContract();
		expect(() => applyEvidence(c2, "c2", { kind: "green", note: "g" })).toThrow(/review/);
	});

	test("cleanup receipt는 note 없이 거부, 상태를 바꾸지 않는다", () => {
		const c = makeContract();
		expect(() => applyEvidence(c, "c1", { kind: "cleanup" })).toThrow(/receipt/);
		applyEvidence(c, "c1", { kind: "cleanup", note: "kill 1234; kill -0 실패 확인" });
		expect(c.criteria[0].status).toBe("pending");
		expect(c.criteria[0].cleanup_receipts).toHaveLength(1);
	});

	test("미등록 criterion id는 등록된 id 목록과 함께 거부된다", () => {
		const c = makeContract();
		expect(() => applyEvidence(c, "nope", { kind: "red", note: "r" })).toThrow(/c1, c2/);
	});
});

describe("완료 판정", () => {
	test("빈 계약은 완료가 아니다", () => {
		expect(isDone(newContract("k", "o", "LIGHT"))).toBe(false);
	});

	test("전부 surfaced일 때만 완료", () => {
		const c = makeContract();
		applyEvidence(c, "c1", { kind: "red", note: "r" });
		applyEvidence(c, "c1", { kind: "green", note: "g" });
		expect(isDone(c)).toBe(false);
		applyEvidence(c, "c1", { kind: "surface", note: "s" });
		applyEvidence(c, "c2", { kind: "surface", note: "리뷰" });
		expect(isDone(c)).toBe(true);
		expect(unproven(c)).toHaveLength(0);
	});
});

describe("아티팩트 검증", () => {
	test("cwd 내부의 비어있지 않은 파일은 통과", () => {
		const p = join(cwd, "evidence.log");
		writeFileSync(p, "RED output");
		expect(validateArtifact(cwd, "evidence.log")).toBe(validateArtifact(cwd, p));
	});

	test("존재하지 않는 경로는 거부", () => {
		expect(() => validateArtifact(cwd, "ghost.log")).toThrow(/존재하지/);
	});

	test("빈 파일은 거부", () => {
		writeFileSync(join(cwd, "empty.log"), "");
		expect(() => validateArtifact(cwd, "empty.log")).toThrow(/비어/);
	});

	test("디렉터리는 거부", () => {
		mkdirSync(join(cwd, "dir"));
		expect(() => validateArtifact(cwd, "dir")).toThrow(/정규 파일/);
	});

	test("허용 루트 밖을 가리키는 심링크는 거부", () => {
		const outside = mkdtempSync(join(tmpdir(), "amaze-outside-"));
		try {
			// tmpdir는 허용 루트라서, containment 실패를 보려면 루트 밖 파일이 필요.
			// /etc/hosts는 항상 존재하는 루트 밖 정규 파일.
			symlinkSync("/etc/hosts", join(cwd, "sneaky.log"));
			expect(() => validateArtifact(cwd, "sneaky.log")).toThrow(/허용 루트/);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("저장/로드", () => {
	test("save→load 라운드트립, listContracts 정렬, statusLine", () => {
		const c = makeContract();
		saveContract(cwd, c);
		const loaded = loadContract(cwd, "fix-login");
		expect(loaded?.objective).toBe("로그인 레이스 수정");
		expect(loaded?.criteria).toHaveLength(2);
		expect(statusLine(loaded!)).toBe("fix-login 0/2");
		expect(listContracts(cwd).map((x) => x.task_key)).toEqual(["fix-login"]);
	});

	test("task_key의 경로 위험 문자는 파일명에서 무해화된다", () => {
		const c = newContract("../evil/key", "x", "LIGHT");
		upsertCriteria(c, [{ scenario: "s", observable: "o" }]);
		saveContract(cwd, c);
		expect(loadContract(cwd, "../evil/key")?.objective).toBe("x");
		expect(listContracts(cwd)).toHaveLength(1);
	});

	test("upsert는 기존 증거를 보존한다", () => {
		const c = makeContract();
		applyEvidence(c, "c1", { kind: "red", note: "r" });
		upsertCriteria(c, [{ id: "c1", scenario: "갱신된 시나리오", observable: "동일" }]);
		expect(c.criteria[0].scenario).toBe("갱신된 시나리오");
		expect(c.criteria[0].status).toBe("red");
		expect(c.criteria[0].evidence.red?.note).toBe("r");
	});
});

describe("정지 게이트 (continuationDirective / activeContract)", () => {
	test("활성 미완 계약은 미증명 id가 담긴 지시문을 반환한다 (enforce 미설정 = on)", () => {
		const c = makeContract();
		const directive = continuationDirective(c);
		expect(directive).toContain("c1[pending]");
		expect(directive).toContain("c2[pending]");
		expect(directive).toContain("plane_task_note(blocker: true)");
	});

	test("enforce=false면 지시문 없음", () => {
		const c = makeContract();
		c.enforce = false;
		expect(continuationDirective(c)).toBeUndefined();
	});

	test("마감(closed_at)되거나 완료된 계약은 지시문 없음", () => {
		const closed = makeContract();
		closed.closed_at = new Date().toISOString();
		expect(continuationDirective(closed)).toBeUndefined();

		const done = makeContract();
		applyEvidence(done, "c1", { kind: "red", note: "r" });
		applyEvidence(done, "c1", { kind: "green", note: "g" });
		applyEvidence(done, "c1", { kind: "surface", note: "s" });
		applyEvidence(done, "c2", { kind: "surface", note: "리뷰" });
		expect(continuationDirective(done)).toBeUndefined();
	});

	test("activeContract는 마감된 계약을 건너뛴다 (needs_review 잔존 버그 방지)", () => {
		const closed = makeContract();
		closed.closed_at = new Date().toISOString();
		saveContract(cwd, closed);
		expect(activeContract(cwd)).toBeUndefined();

		const open = newContract("second", "다음 작업", "LIGHT");
		upsertCriteria(open, [{ scenario: "s", observable: "o" }]);
		saveContract(cwd, open);
		expect(activeContract(cwd)?.task_key).toBe("second");
	});
});
