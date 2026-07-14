// Plane 작업 기록/기억 저장소 브릿지 + amaze 계약(contract) 툴.
//
// raw MCP로 하면 여러 번 왕복해야 하는 작업
// (프로젝트 resolve -> 워크아이템 find-or-create -> 상태 resolve -> 상태전환
// -> 코멘트 -> read-back)을 툴 호출 1번으로 압축한 좁은 범위 툴들.
// Plane REST API를 직접 호출한다(plane-mcp MCP 서버를 거치지 않음) — 그래서
// plane MCP 서버가 연결 안 돼 있어도 이 툴들을 쓰는 데 드는 MCP 툴 스키마
// 컨텍스트 비용이 0이다.
//
// amaze_contract_* 툴은 lib/contract-core.ts의 로컬 계약 상태
// (.omp/amaze/<task_key>.json)를 결정적으로 관리하고, Plane은 코스 단위
// 미러(시작/완료/코멘트)로만 쓴다. failing-first 전이와 완료 판정은
// 프롬프트가 아니라 코드가 강제한다.
//
// 필요한 환경변수:
//   PLANE_API_KEY        - Plane 개인/워크스페이스 액세스 토큰
//   PLANE_WORKSPACE_SLUG - 기본값 "my-workspace"
//   PLANE_BASE_URL        - 기본값 "https://plane.example.com"
//
// 프로젝트 매핑: 레포당 Plane 프로젝트 1개 (skills/plane-workflow SKILL.md의
// "프로젝트 매핑" 섹션 참고). 워크아이템은 external_source="omp-task"
// + external_id=<task_key>로 매칭하므로 task_key별로 find-or-create가
// 멱등(idempotent)하다. task_key는 작업 단위를 정하는 명시적 식별자다.

import { basename } from "node:path";
import type { CustomToolAPI, CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import {
	activeContract,
	applyEvidence,
	isDone,
	listContracts,
	loadContract,
	newContract,
	saveContract,
	summarize,
	unproven,
	upsertCriteria,
	validateArtifact,
	type Contract,
} from "../lib/contract-core";

const PLANE_BASE_URL = process.env.PLANE_BASE_URL ?? "https://plane.example.com";
const PLANE_WORKSPACE_SLUG = process.env.PLANE_WORKSPACE_SLUG ?? "my-workspace";

function requireApiKey(): string {
	const key = process.env.PLANE_API_KEY;
	if (!key) {
		throw new Error("PLANE_API_KEY가 설정되지 않았습니다 — plane_task_* 툴을 쓰기 전에 export 하세요.");
	}
	return key;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeProjectName(repoName: string): string {
	// Plane 프로젝트 name 필드는 하이픈 등 특수문자를 거부한다(400 에러 확인됨).
	return repoName.replace(/[^a-zA-Z0-9]+/g, " ").trim() || "repo";
}

function deriveIdentifier(repoName: string): string {
	const alnum = repoName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return alnum.slice(0, 8) || "REPO";
}

const factory: CustomToolFactory = (pi) => {
	const z = pi.zod;

	const ProjectSchema = z
		.object({ id: z.string(), name: z.string(), identifier: z.string() })
		.passthrough();
	type Project = z.infer<typeof ProjectSchema>;

	const StateSchema = z.object({ id: z.string(), name: z.string(), group: z.string() }).passthrough();
	type PlaneState = z.infer<typeof StateSchema>;

	const WorkItemSchema = z
		.object({
			id: z.string(),
			name: z.string(),
			sequence_id: z.number(),
			state: z.string(),
			external_source: z.string().nullable().optional(),
			external_id: z.string().nullable().optional(),
		})
		.passthrough();
	type WorkItem = z.infer<typeof WorkItemSchema>;

	const CommentSchema = z
		.object({ id: z.string(), comment_html: z.string().nullable().optional() })
		.passthrough();

	function listSchema<T extends z.ZodTypeAny>(item: T) {
		return z.union([z.array(item), z.object({ results: z.array(item) }).passthrough()]);
	}

	function toArray<T>(parsed: T[] | { results: T[] }): T[] {
		return Array.isArray(parsed) ? parsed : parsed.results;
	}

	async function planeFetch<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
		const res = await fetch(`${PLANE_BASE_URL}/api/v1/workspaces/${PLANE_WORKSPACE_SLUG}${path}`, {
			...init,
			headers: {
				"x-api-key": requireApiKey(),
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`Plane API ${res.status} ${init?.method ?? "GET"} ${path}: ${text.slice(0, 300)}`);
		}
		const json: unknown = await res.json();
		return schema.parse(json);
	}

	async function getProject(id: string): Promise<Project> {
		return planeFetch(`/projects/${id}/`, ProjectSchema);
	}

	async function resolveProject(repoName: string): Promise<Project> {
		const data = await planeFetch(`/projects/`, listSchema(ProjectSchema));
		const projects = toArray(data);
		const identifier = deriveIdentifier(repoName);
		const name = sanitizeProjectName(repoName);
		const existing = projects.find(
			(p) => p.identifier === identifier || p.name.toLowerCase() === name.toLowerCase(),
		);
		if (existing) return existing;
		return planeFetch(`/projects/`, ProjectSchema, {
			method: "POST",
			body: JSON.stringify({ name, identifier, description: `${repoName} 레포용 프로젝트` }),
		});
	}

	async function resolveState(
		projectId: string,
		group: "started" | "completed" | "backlog" | "unstarted" | "cancelled",
	): Promise<PlaneState> {
		const data = await planeFetch(`/projects/${projectId}/states/`, listSchema(StateSchema));
		const states = toArray(data);
		const match = states.find((s) => s.group === group);
		if (!match) throw new Error(`프로젝트 ${projectId}에 group=${group}인 상태가 없습니다`);
		return match;
	}

	async function getWorkItem(projectId: string, id: string): Promise<WorkItem> {
		return planeFetch(`/projects/${projectId}/issues/${id}/`, WorkItemSchema);
	}

	async function listWorkItems(projectId: string): Promise<WorkItem[]> {
		const data = await planeFetch(`/projects/${projectId}/issues/`, listSchema(WorkItemSchema));
		return toArray(data);
	}

	async function findWorkItemByExternalId(projectId: string, externalId: string): Promise<WorkItem | undefined> {
		const items = await listWorkItems(projectId);
		return items.find((i) => i.external_id === externalId);
	}

	async function createWorkItem(
		projectId: string,
		name: string,
		descriptionText: string,
		stateId: string,
		externalId: string,
	): Promise<WorkItem> {
		return planeFetch(`/projects/${projectId}/issues/`, WorkItemSchema, {
			method: "POST",
			body: JSON.stringify({
				name,
				description_html: `<p>${escapeHtml(descriptionText)}</p>`,
				state: stateId,
				external_source: "omp-task",
				external_id: externalId,
			}),
		});
	}

	async function updateWorkItemState(projectId: string, workItemId: string, stateId: string): Promise<WorkItem> {
		return planeFetch(`/projects/${projectId}/issues/${workItemId}/`, WorkItemSchema, {
			method: "PATCH",
			body: JSON.stringify({ state: stateId }),
		});
	}

	async function addComment(projectId: string, workItemId: string, html: string): Promise<void> {
		await planeFetch(`/projects/${projectId}/issues/${workItemId}/comments/`, CommentSchema, {
			method: "POST",
			body: JSON.stringify({ comment_html: html }),
		});
	}

	interface ResolveParams {
		repo?: string;
		project_id?: string;
		work_item_id?: string;
		task_key?: string;
	}

	function repoNameOf(api: CustomToolAPI, params: ResolveParams): string {
		return params.repo ?? basename(api.cwd);
	}

	async function resolveContext(api: CustomToolAPI, params: ResolveParams): Promise<{ project: Project; item: WorkItem }> {
		const repoName = repoNameOf(api, params);
		const project = params.project_id ? await getProject(params.project_id) : await resolveProject(repoName);
		let item: WorkItem | undefined;
		if (params.work_item_id) {
			item = await getWorkItem(project.id, params.work_item_id);
		} else if (params.task_key) {
			item = await findWorkItemByExternalId(project.id, params.task_key);
		}
		if (!item) {
			throw new Error(
				`"${repoName}"에서 워크아이템을 특정할 수 없습니다. work_item_id 또는 task_key를 넘기거나 plane_task_start를 먼저 실행하세요.`,
			);
		}
		return { project, item };
	}

	function identifierOf(project: Project, item: WorkItem): string {
		return `${project.identifier}-${item.sequence_id}`;
	}

	return [
		{
			name: "plane_task_start",
			label: "Plane: 작업 시작",
			description:
				"Plane에 작업을 레포별 영구 메모리로 기록하기 시작한다. 현재 레포(cwd 이름 또는 repo override)에 매핑된 Plane 프로젝트를 resolve하거나(없으면 생성), task_key로 워크아이템을 find-or-create(멱등)하고, 프로젝트의 시작 상태로 전환하고, 작업 개요를 시작 코멘트로 남긴다. 툴 1번 호출로 여러 단계짜리 수동 MCP 시퀀스를 대체한다.",
			parameters: z.object({
				task: z.string().describe("무엇을, 왜 하는지 — 시작 코멘트가 되고, 새로 만드는 경우 워크아이템 이름/설명이 된다."),
				task_key: z.string().describe("이 작업의 안정적 식별자(external_id). 같은 key로 다시 부르면 같은 워크아이템을 이어받는다."),
				repo: z.string().optional().describe("레포/프로젝트 이름 override; 기본값은 현재 작업 디렉터리 이름."),
			}),
			async execute(_toolCallId, params) {
				const repoName = repoNameOf(pi, params);
				const project = await resolveProject(repoName);
				const startedState = await resolveState(project.id, "started");
				let item = await findWorkItemByExternalId(project.id, params.task_key);
				item = item
					? await updateWorkItemState(project.id, item.id, startedState.id)
					: await createWorkItem(project.id, params.task.slice(0, 120), params.task, startedState.id, params.task_key);
				await addComment(project.id, item.id, `<p><b>시작</b>: ${escapeHtml(params.task)}</p>`);
				const identifier = identifierOf(project, item);
				return {
					content: [{ type: "text", text: `${identifier} 시작함: ${item.name} (프로젝트 ${project.name})` }],
					details: { project_id: project.id, work_item_id: item.id, identifier },
				};
			},
		},
		{
			name: "plane_task_complete",
			label: "Plane: 작업 완료",
			description:
				"작업 추적을 마무리한다: 완료 요약 코멘트를 남기고, 워크아이템을 프로젝트의 완료 상태로 전환하고(needs_review가 true면 완료 대신 started 상태로 남겨 리뷰 대기임을 표시), read-back으로 확인한다. amaze 계약이 있으면 미증명 criterion이 남아 있는 한 에러로 거부된다(코드 게이트) — needs_review만 우회. work_item_id를 알면 plane_task_start/amaze_contract_set의 결과값을 넘기고, 모르면 task_key(+repo)로 resolve한다.",
			parameters: z.object({
				summary: z.string().describe("무엇이 바뀌었고 어떻게 검증했는지 — 완료 코멘트가 된다."),
				work_item_id: z.string().optional(),
				task_key: z.string().optional().describe("work_item_id를 모를 때 이 key로 워크아이템을 resolve한다."),
				project_id: z.string().optional(),
				repo: z.string().optional(),
				needs_review: z.boolean().optional().describe("완전히 끝난 게 아니라 아직 리뷰가 필요하면 true."),
			}),
			async execute(_toolCallId, params) {
				const contract = params.task_key
					? loadContract(pi.cwd, params.task_key)
					: listContracts(pi.cwd).find((c) => c.plane?.work_item_id === params.work_item_id);
				if (!params.needs_review && contract && !isDone(contract)) {
					const open = unproven(contract);
					throw new Error(
						`계약 게이트: 미증명 criterion ${open.map((c) => `${c.id}[${c.status}]`).join(", ")} — ` +
							`amaze_evidence로 증명을 마치거나, 리뷰 대기라면 needs_review: true로 호출하세요.`,
					);
				}
				const { project, item } = await resolveContext(pi, params);
				const label = params.needs_review ? "리뷰 대기" : "완료";
				await addComment(project.id, item.id, `<p><b>${label}</b>: ${escapeHtml(params.summary)}</p>`);
				const targetState = await resolveState(project.id, params.needs_review ? "started" : "completed");
				const updated = await updateWorkItemState(project.id, item.id, targetState.id);
				const confirmed = await getWorkItem(project.id, item.id);
				const identifier = identifierOf(project, confirmed);
				if (contract && !contract.closed_at) {
					// 마감 — needs_review 포함. 상태바/컴팩션/정지 게이트에서 이 계약이 빠진다.
					contract.closed_at = new Date().toISOString();
					saveContract(pi.cwd, contract);
				}
				return {
					content: [{ type: "text", text: `${identifier} ${label}: 상태=${confirmed.state === targetState.id ? targetState.name : confirmed.state}` }],
					details: { project_id: project.id, work_item_id: updated.id, identifier, state: confirmed.state },
				};
			},
		},
		{
			name: "plane_task_lookup",
			label: "Plane: 작업 조회",
			description:
				"읽기 전용: 레포에 매핑된 Plane 프로젝트를 resolve하고 그 프로젝트의 워크아이템 목록을 조회한다(워크아이템 이름 부분 문자열로 대소문자 무시 필터링 가능). '이 레포에 뭐가 추적되고 있나' 정도만 필요할 때 raw list_projects/list_work_items/search_work_items MCP 왕복 대신 이 툴을 쓴다.",
			parameters: z.object({
				repo: z.string().optional(),
				query: z.string().optional().describe("워크아이템 이름에 대한 대소문자 무시 부분 문자열 필터."),
			}),
			async execute(_toolCallId, params) {
				const repoName = repoNameOf(pi, params);
				const project = await resolveProject(repoName);
				let items = await listWorkItems(project.id);
				if (params.query) {
					const q = params.query.toLowerCase();
					items = items.filter((i) => i.name.toLowerCase().includes(q));
				}
				const lines = items.map((i) => `${project.identifier}-${i.sequence_id}: ${i.name} [상태 ${i.state}]`);
				return {
					content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : `${project.name}에 워크아이템이 없습니다.` }],
					details: { project_id: project.id, identifier: project.identifier, count: items.length },
				};
			},
		},
		{
			name: "plane_task_note",
			label: "Plane: 메모 추가",
			description:
				"상태 전환 없이 중간 진행 상황 코멘트만 추가한다 — plane_task_start와 plane_task_complete 사이에 기록해둘 만한 체크포인트가 있을 때, 전체 상태전환 동기화 비용 없이 코멘트 호출 1번으로 처리한다.",
			parameters: z.object({
				note: z.string(),
				work_item_id: z.string().optional(),
				task_key: z.string().optional().describe("work_item_id를 모를 때 이 key로 워크아이템을 resolve한다."),
				project_id: z.string().optional(),
				repo: z.string().optional(),
			}),
			async execute(_toolCallId, params) {
				const { project, item } = await resolveContext(pi, params);
				await addComment(project.id, item.id, `<p>${escapeHtml(params.note)}</p>`);
				return {
					content: [{ type: "text", text: `${identifierOf(project, item)}에 메모 추가함` }],
					details: { project_id: project.id, work_item_id: item.id, identifier: identifierOf(project, item) },
				};
			},
		},
		{
			name: "plane_task_block",
			label: "Plane: 블로커 표시",
			description:
				"블로커를 표시 코멘트로 남긴다 — 사람이 챙길 수 있게 드러내되, Plane 워크아이템 자체의 상태는 건드리지 않는다. amaze 계약이 있으면 session_stop continuation 게이트도 해제한다(enforce=false) — 인간 개입 대기 중 재촉을 멈춘다. 재개 시 amaze_contract_set이 다시 잠근다.",
			parameters: z.object({
				reason: z.string(),
				work_item_id: z.string().optional(),
				task_key: z.string().optional().describe("work_item_id를 모를 때 이 key로 워크아이템을 resolve한다."),
				project_id: z.string().optional(),
				repo: z.string().optional(),
			}),
			async execute(_toolCallId, params) {
				const { project, item } = await resolveContext(pi, params);
				await addComment(project.id, item.id, `<p><b>블로킹</b>: ${escapeHtml(params.reason)}</p>`);
				const contract = params.task_key
					? loadContract(pi.cwd, params.task_key)
					: listContracts(pi.cwd).find((c) => c.plane?.work_item_id === item.id);
				if (contract && contract.enforce !== false) {
					contract.enforce = false;
					saveContract(pi.cwd, contract);
				}
				return {
					content: [{ type: "text", text: `${identifierOf(project, item)} 블로킹 표시함` }],
					details: { project_id: project.id, work_item_id: item.id, identifier: identifierOf(project, item) },
				};
			},
		},
		{
			name: "amaze_contract_set",
			label: "Amaze: 계약 등록",
			description:
				"amaze 성공기준 계약을 등록/갱신한다. 로컬 계약 파일(.omp/amaze/<task_key>.json)을 생성하거나 criteria를 id 기준 upsert(기존 증거 보존)하고, Plane 워크아이템을 find-or-create해 계약 전문을 시작 코멘트로 남긴다(plane_task_start 흡수 — 따로 부를 필요 없음). 등록된 계약은 기본적으로 session_stop continuation 게이트를 잠근다(enforce=false로 끌 수 있음; plane_task_block도 해제). 이후 증거는 amaze_evidence, 진행 확인은 amaze_status, 완료는 plane_task_complete(계약 게이트 적용).",
			parameters: z.object({
				task_key: z.string().describe("계약의 안정적 식별자 — Plane external_id와 로컬 파일명으로 쓰인다."),
				objective: z.string().describe("한 문장 목표 — 워크아이템 이름/설명이 된다."),
				tier: z.enum(["LIGHT", "HEAVY"]),
				criteria: z
					.array(
						z.object({
							id: z.string().optional().describe("생략 시 c1, c2… 자동 부여."),
							scenario: z.string().describe("문자 그대로의 명령/페이지 액션/페이로드."),
							observable: z.string().describe("PASS/FAIL을 가르는 단일 이진 관찰값."),
							proof: z
								.enum(["red-green", "review"])
								.optional()
								.describe("기본 red-green(failing-first 강제). 기계 소비자 없는 순수 산문 변경만 review(서피스 직행)."),
						}),
					)
					.min(1),
				repo: z.string().optional().describe("레포/프로젝트 이름 override; 기본값은 cwd 이름."),
				enforce: z
					.boolean()
					.optional()
					.describe("기본 true: 미증명 criterion이 남아 있으면 세션 정지 시 continuation을 강제. false면 계약 추적만 하고 게이트는 잠그지 않는다."),
			}),
			async execute(_toolCallId, params) {
				const contract: Contract = loadContract(pi.cwd, params.task_key) ?? newContract(params.task_key, params.objective, params.tier);
				contract.objective = params.objective;
				contract.tier = params.tier;
				contract.enforce = params.enforce ?? true;
				contract.closed_at = undefined; // 재등록 = 재개: 마감 해제, 게이트 재무장.
				upsertCriteria(contract, params.criteria);

				let planeLine = "Plane 미러 생략(PLANE_API_KEY 없음) — 로컬 계약만 기록됨.";
				if (process.env.PLANE_API_KEY) {
					const repoName = repoNameOf(pi, params);
					const project = await resolveProject(repoName);
					const startedState = await resolveState(project.id, "started");
					let item = await findWorkItemByExternalId(project.id, params.task_key);
					item = item
						? await updateWorkItemState(project.id, item.id, startedState.id)
						: await createWorkItem(project.id, params.objective.slice(0, 120), params.objective, startedState.id, params.task_key);
					const criteriaHtml = contract.criteria
						.map((c) => `<li>${escapeHtml(`${c.id} [${c.proof}]: ${c.scenario} → ${c.observable}`)}</li>`)
						.join("");
					await addComment(
						project.id,
						item.id,
						`<p><b>계약</b> [${contract.tier}]: ${escapeHtml(params.objective)}</p><ul>${criteriaHtml}</ul>`,
					);
					contract.plane = { project_id: project.id, work_item_id: item.id, identifier: identifierOf(project, item) };
					planeLine = `${contract.plane.identifier}에 계약 기록됨.`;
				}
				saveContract(pi.cwd, contract);
				return {
					content: [{ type: "text", text: `${summarize(contract)}\n${planeLine}` }],
					details: {
						task_key: contract.task_key,
						project_id: contract.plane?.project_id,
						work_item_id: contract.plane?.work_item_id,
						identifier: contract.plane?.identifier,
					},
				};
			},
		},
		{
			name: "amaze_evidence",
			label: "Amaze: 증거 기록",
			description:
				"criterion에 증거를 기록하고 전이 규칙을 결정적으로 강제한다: red/green/surface는 artifact_path 필수(실재하는 비어있지 않은 파일, cwd/tmp/~/.omp 안); RED 없이 GREEN 거부(failing-first), GREEN 전 SURFACE 거부, proof=review는 SURFACE 직행; cleanup은 note 필수 receipt. Plane 왕복 없음 — 고빈도로 불러도 무료.",
			parameters: z.object({
				task_key: z.string(),
				criterion_id: z.string(),
				kind: z.enum(["red", "green", "surface", "cleanup"]),
				artifact_path: z.string().optional().describe("증거 아티팩트 파일 경로. red/green/surface에 필수."),
				note: z.string().optional().describe("한 줄 요지. cleanup receipt에는 필수."),
			}),
			async execute(_toolCallId, params) {
				const contract = loadContract(pi.cwd, params.task_key);
				if (!contract) {
					throw new Error(`계약 "${params.task_key}"이 없습니다 — amaze_contract_set을 먼저 실행하세요.`);
				}
				let realPath: string | undefined;
				if (params.artifact_path) {
					realPath = validateArtifact(pi.cwd, params.artifact_path);
				} else if (params.kind !== "cleanup") {
					throw new Error(`${params.kind} 증거에는 artifact_path가 필수입니다 — 출력을 파일로 캡처한 뒤 그 경로를 넘기세요.`);
				}
				const criterion = applyEvidence(contract, params.criterion_id, {
					kind: params.kind,
					path: realPath,
					note: params.note,
				});
				saveContract(pi.cwd, contract);
				const open = unproven(contract);
				const remaining = open.length === 0 ? "모든 criterion 증명 완료 — plane_task_complete 가능." : `미증명 ${open.length}건: ${open.map((c) => c.id).join(", ")}`;
				return {
					content: [{ type: "text", text: `${criterion.id} → ${criterion.status} (${params.kind}). ${remaining}` }],
					details: { task_key: contract.task_key, criterion_id: criterion.id, status: criterion.status, remaining: open.length },
				};
			},
		},
		{
			name: "amaze_status",
			label: "Amaze: 계약 상태",
			description:
				"로컬 계약 요약 1콜 — criterion별 상태/증거 경로/미증명 목록. 컴팩션이나 세션 재개 후 계약 복구는 notepad 재독 대신 이걸 쓴다. task_key 생략 시 가장 최근에 갱신된 미완료 계약.",
			parameters: z.object({
				task_key: z.string().optional(),
			}),
			async execute(_toolCallId, params) {
				const contract = params.task_key ? loadContract(pi.cwd, params.task_key) : activeContract(pi.cwd);
				if (!contract) {
					const known = listContracts(pi.cwd).map((c) => c.task_key);
					return {
						content: [
							{
								type: "text",
								text: known.length > 0 ? `미완료 계약 없음. 알려진 계약: ${known.join(", ")}` : "이 레포에 amaze 계약이 없습니다 — amaze_contract_set으로 시작하세요.",
							},
						],
						details: { count: known.length },
					};
				}
				return {
					content: [{ type: "text", text: summarize(contract) }],
					details: { task_key: contract.task_key, done: isDone(contract), remaining: unproven(contract).length },
				};
			},
		},
	];
};

export default factory;
