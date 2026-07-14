// 계약 상태 코어 — `.omp/amaze/<task_key>.json`이 단일 진실원.
//
// amaze 워크플로우의 "계약"(성공기준 + failing-first 증거 + 완료 판정)을
// 프롬프트가 아니라 이 zero-dep 모듈이 결정적으로 강제한다:
//   - 전이 규칙: pending -> red -> green -> surfaced (proof="review"만 직행 허용)
//   - 증거 검증: 경로 실재 + realpath containment + 비어있지 않은 정규 파일
//   - 완료 판정: isDone()은 순수 함수 — LLM 자기신고가 아님
// (lazycodex boulder-state / ulw-loop goal-status 패턴의 amaze판.)

import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

export type Tier = "LIGHT" | "HEAVY";
export type ProofMode = "red-green" | "review";
export type EvidenceKind = "red" | "green" | "surface" | "cleanup";
export type CriterionStatus = "pending" | "red" | "green" | "surfaced";

export interface Evidence {
	at: string;
	path?: string;
	note?: string;
}

export interface Criterion {
	id: string;
	scenario: string;
	observable: string;
	proof: ProofMode;
	status: CriterionStatus;
	evidence: { red?: Evidence; green?: Evidence; surface?: Evidence };
	cleanup_receipts: Evidence[];
}

export interface PlaneRef {
	project_id: string;
	work_item_id: string;
	identifier: string;
}

export interface Contract {
	version: 1;
	task_key: string;
	objective: string;
	tier: Tier;
	plane?: PlaneRef;
	criteria: Criterion[];
	/** false면 session_stop continuation 게이트 해제. 없으면 on (amaze 루프 기본). */
	enforce?: boolean;
	/** plane_task_complete가 찍는 마감 시각 — needs_review 포함. 마감된 계약은 비활성. */
	closed_at?: string;
	created_at: string;
	updated_at: string;
}

const STATE_DIR = ".omp/amaze";

export function contractDir(cwd: string): string {
	return join(cwd, STATE_DIR);
}

export function contractPath(cwd: string, taskKey: string): string {
	const safe = taskKey.replace(/[^a-zA-Z0-9._-]+/g, "-");
	return join(contractDir(cwd), `${safe}.json`);
}

export function loadContract(cwd: string, taskKey: string): Contract | undefined {
	try {
		const raw = readFileSync(contractPath(cwd, taskKey), "utf8");
		return JSON.parse(raw) as Contract;
	} catch {
		return undefined;
	}
}

export function listContracts(cwd: string): Contract[] {
	let names: string[];
	try {
		names = readdirSync(contractDir(cwd)).filter((n) => n.endsWith(".json"));
	} catch {
		return [];
	}
	const out: Contract[] = [];
	for (const name of names) {
		try {
			out.push(JSON.parse(readFileSync(join(contractDir(cwd), name), "utf8")) as Contract);
		} catch {
			// 손상 파일은 건너뛴다 — 계약 강제가 손상 하나로 전부 죽으면 안 됨.
		}
	}
	return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** tmp 파일 + rename으로 원자적 저장. */
export function saveContract(cwd: string, contract: Contract): void {
	contract.updated_at = new Date().toISOString();
	const path = contractPath(cwd, contract.task_key);
	mkdirSync(contractDir(cwd), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(contract, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

export function newContract(taskKey: string, objective: string, tier: Tier): Contract {
	const now = new Date().toISOString();
	return {
		version: 1,
		task_key: taskKey,
		objective,
		tier,
		criteria: [],
		created_at: now,
		updated_at: now,
	};
}

export interface CriterionInput {
	id?: string;
	scenario: string;
	observable: string;
	proof?: ProofMode;
}

/** id 기준 upsert — 기존 criterion의 증거/상태는 보존한다. */
export function upsertCriteria(contract: Contract, inputs: CriterionInput[]): void {
	inputs.forEach((input, index) => {
		const id = input.id ?? `c${index + 1}`;
		const existing = contract.criteria.find((c) => c.id === id);
		if (existing) {
			existing.scenario = input.scenario;
			existing.observable = input.observable;
			if (input.proof) existing.proof = input.proof;
			return;
		}
		contract.criteria.push({
			id,
			scenario: input.scenario,
			observable: input.observable,
			proof: input.proof ?? "red-green",
			status: "pending",
			evidence: {},
			cleanup_receipts: [],
		});
	});
}

export function unproven(contract: Contract): Criterion[] {
	return contract.criteria.filter((c) => c.status !== "surfaced");
}

/** 완료 = criterion이 1개 이상이고 전부 surfaced. 빈 계약은 완료가 아니다. */
export function isDone(contract: Contract): boolean {
	return contract.criteria.length > 0 && unproven(contract).length === 0;
}

/**
 * 증거 아티팩트 경로의 결정적 검증.
 * 실재하는 비어있지 않은 정규 파일이어야 하고, realpath가 허용 루트
 * (cwd, tmpdir, ~/.omp — 세션 local:// 아티팩트 위치) 안이어야 한다.
 * lazycodex 교훈: 심링크/디렉터리로 containment를 우회하는 위조를 거부.
 */
export function validateArtifact(cwd: string, artifactPath: string): string {
	const abs = isAbsolute(artifactPath) ? artifactPath : resolve(cwd, artifactPath);
	let real: string;
	try {
		real = realpathSync(abs);
	} catch {
		throw new Error(`증거 아티팩트가 존재하지 않습니다: ${abs}`);
	}
	const stat = statSync(real);
	if (!stat.isFile()) throw new Error(`증거 아티팩트가 정규 파일이 아닙니다: ${real}`);
	if (stat.size === 0) throw new Error(`증거 아티팩트가 비어 있습니다: ${real}`);
	const roots = [cwd, tmpdir(), join(homedir(), ".omp")].map((r) => {
		try {
			return realpathSync(r);
		} catch {
			return r;
		}
	});
	const contained = roots.some((root) => real === root || real.startsWith(root + sep));
	if (!contained) {
		throw new Error(`증거 아티팩트가 허용 루트(cwd, tmpdir, ~/.omp) 밖에 있습니다: ${real}`);
	}
	return real;
}

export interface EvidenceInput {
	kind: EvidenceKind;
	path?: string;
	note?: string;
}

/**
 * 증거를 적용하고 전이 규칙을 강제한다. 위반 시 throw.
 *   red:     pending|red 에서만 (재캡처 허용)
 *   green:   red 증거가 이미 있어야 함 — failing-first를 코드로 강제
 *   surface: green 이후, 또는 proof="review"면 직행
 *   cleanup: 상태 무관, note 필수 receipt 추가
 */
export function applyEvidence(contract: Contract, criterionId: string, input: EvidenceInput): Criterion {
	const criterion = contract.criteria.find((c) => c.id === criterionId);
	if (!criterion) {
		const known = contract.criteria.map((c) => c.id).join(", ") || "(없음)";
		throw new Error(`criterion "${criterionId}"이 계약에 없습니다. 등록된 id: ${known}`);
	}
	const evidence: Evidence = { at: new Date().toISOString(), path: input.path, note: input.note };

	switch (input.kind) {
		case "cleanup":
			if (!input.note && !input.path) throw new Error("cleanup receipt에는 note 또는 path가 필요합니다.");
			criterion.cleanup_receipts.push(evidence);
			return criterion;
		case "red":
			if (criterion.status !== "pending" && criterion.status !== "red") {
				throw new Error(`RED는 pending 상태에서만 캡처합니다 (현재: ${criterion.status}). 이미 GREEN인 criterion의 RED 재작성은 failing-first 위조입니다.`);
			}
			criterion.evidence.red = evidence;
			criterion.status = "red";
			return criterion;
		case "green":
			if (criterion.proof === "review") {
				throw new Error(`criterion "${criterionId}"은 proof=review입니다 — RED/GREEN 없이 surface(리뷰 근거)로 직행하세요.`);
			}
			if (!criterion.evidence.red) {
				throw new Error(`failing-first 위반: criterion "${criterionId}"에 RED 증거가 없습니다. 구현 전에 실패를 먼저 캡처하세요.`);
			}
			criterion.evidence.green = evidence;
			criterion.status = "green";
			return criterion;
		case "surface":
			if (criterion.proof !== "review" && criterion.status !== "green") {
				throw new Error(`SURFACE는 GREEN 이후입니다 (현재: ${criterion.status}). proof=review criterion만 직행할 수 있습니다.`);
			}
			criterion.evidence.surface = evidence;
			criterion.status = "surfaced";
			return criterion;
	}
}

/** 상태바용 한 줄: "AMAZEOMP-1 2/5" 또는 "amaze-x 2/5". */
export function statusLine(contract: Contract): string {
	const done = contract.criteria.filter((c) => c.status === "surfaced").length;
	const label = contract.plane?.identifier ?? contract.task_key;
	return `${label} ${done}/${contract.criteria.length}`;
}

/** 컴팩션 보존/amaze_status용 압축 텍스트 요약. */
export function summarize(contract: Contract): string {
	const lines = [
		`amaze 계약 ${contract.task_key} [${contract.tier}]${contract.plane ? ` (${contract.plane.identifier})` : ""}: ${contract.objective}`,
	];
	for (const c of contract.criteria) {
		const ev = [
			c.evidence.red ? `RED:${c.evidence.red.path ?? "note"}` : undefined,
			c.evidence.green ? `GREEN:${c.evidence.green.path ?? "note"}` : undefined,
			c.evidence.surface ? `SURFACE:${c.evidence.surface.path ?? "note"}` : undefined,
			c.cleanup_receipts.length > 0 ? `receipts:${c.cleanup_receipts.length}` : undefined,
		]
			.filter(Boolean)
			.join(" ");
		lines.push(`- [${c.status}] ${c.id}: ${c.scenario} → ${c.observable}${ev ? ` (${ev})` : ""}`);
	}
	const open = unproven(contract);
	lines.push(open.length === 0 ? "모든 criterion 증명 완료." : `미증명 ${open.length}건: ${open.map((c) => c.id).join(", ")}`);
	return lines.join("\n");
}

/** 가장 최근에 갱신된, 마감되지 않은 미완료 계약 — 상태바/컴팩션/정지 게이트 훅이 사용. */
export function activeContract(cwd: string): Contract | undefined {
	return listContracts(cwd).find((c) => !c.closed_at && !isDone(c));
}

/**
 * session_stop 강제 continuation 지시문. 게이트가 잠겨 있어야 할 때만 문자열을
 * 반환한다: 활성(미마감·미완) 계약이고 enforce가 명시적으로 꺼져 있지 않을 때.
 * 무한루프 방지는 하네스의 연속 8회 상한에 위임한다.
 */
export function continuationDirective(contract: Contract): string | undefined {
	if (contract.enforce === false || contract.closed_at || isDone(contract)) return undefined;
	const open = unproven(contract);
	return (
		`amaze 계약 "${contract.task_key}"에 미증명 criterion이 남아 있습니다: ` +
		`${open.map((c) => `${c.id}[${c.status}]`).join(", ")}. ` +
		`amaze_evidence로 증명을 계속하거나, 인간 개입이 필요하면 plane_task_block(게이트 해제), ` +
		`리뷰 대기로 넘기려면 plane_task_complete(needs_review: true)를 호출하세요.`
	);
}
