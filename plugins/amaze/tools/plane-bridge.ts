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
				"Start tracking a task in Plane: resolve (or create) the project mapped to this repo, find-or-create the work item by task_key (idempotent), move it to the started state, and post the task as a start comment.",
			parameters: z.object({
				task: z.string().describe("What and why — becomes the start comment, and the work item name/description when created."),
				task_key: z.string().describe("Stable identifier (external_id); the same key resumes the same work item."),
				repo: z.string().optional().describe("Repo/project name override; defaults to cwd basename."),
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
				"Finish tracking: post the summary comment, transition to completed (needs_review keeps it in started as review-pending), verify by read-back. Errors while an amaze contract has unproven criteria (code gate; needs_review bypasses). Resolve via work_item_id or task_key(+repo).",
			parameters: z.object({
				summary: z.string().describe("What changed and how it was verified — becomes the completion comment."),
				work_item_id: z.string().optional(),
				task_key: z.string().optional().describe("Resolves the work item when work_item_id is unknown."),
				project_id: z.string().optional(),
				repo: z.string().optional(),
				needs_review: z.boolean().optional().describe("True when review is still pending."),
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
				"Read-only: resolve this repo's Plane project and list its work items (optional case-insensitive name substring filter).",
			parameters: z.object({
				repo: z.string().optional(),
				query: z.string().optional().describe("Case-insensitive substring filter on work item names."),
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
			label: "Plane: 메모/블로커",
			description:
				"Add a progress comment without a state transition. With blocker: true, mark it as a blocker for humans and, if an amaze contract exists, disarm the session-stop continuation gate (enforce=false) until amaze_contract_set re-arms it.",
			parameters: z.object({
				note: z.string(),
				blocker: z.boolean().optional().describe("Mark as blocker and disarm the contract's stop gate."),
				work_item_id: z.string().optional(),
				task_key: z.string().optional().describe("Resolves the work item when work_item_id is unknown."),
				project_id: z.string().optional(),
				repo: z.string().optional(),
			}),
			async execute(_toolCallId, params) {
				const { project, item } = await resolveContext(pi, params);
				const html = params.blocker ? `<p><b>블로킹</b>: ${escapeHtml(params.note)}</p>` : `<p>${escapeHtml(params.note)}</p>`;
				await addComment(project.id, item.id, html);
				if (params.blocker) {
					const contract = params.task_key
						? loadContract(pi.cwd, params.task_key)
						: listContracts(pi.cwd).find((c) => c.plane?.work_item_id === item.id);
					if (contract && contract.enforce !== false) {
						contract.enforce = false;
						saveContract(pi.cwd, contract);
					}
				}
				return {
					content: [{ type: "text", text: `${identifierOf(project, item)}에 ${params.blocker ? "블로커" : "메모"} 기록함` }],
					details: { project_id: project.id, work_item_id: item.id, identifier: identifierOf(project, item) },
				};
			},
		},
		{
			name: "plane_progress_note",
			label: "Plane: 진행 코멘트(서브에이전트)",
			description:
				"Comment-only progress note for delegated subagents: appends a comment to a parent-issued work item. Requires explicit project_id + work_item_id (no repo resolution, no lookup, no find-or-create). No state transitions, no blocker semantics, no contract mutation — those remain parent-orchestrator-only.",
			parameters: z.object({
				project_id: z.string().describe("Parent-issued Plane project id."),
				work_item_id: z.string().describe("Parent-issued work item id."),
				note: z.string().describe("Progress note; use the sectioned comment format for substantial checkpoints."),
				agent: z.string().optional().describe("Reporting agent name; prefixed to the comment as [agent:<name>]."),
			}),
			async execute(_toolCallId, params) {
				const project = await getProject(params.project_id);
				const item = await getWorkItem(project.id, params.work_item_id);
				const tag = params.agent ? `[agent:${params.agent}] ` : "";
				await addComment(project.id, item.id, `<p>${escapeHtml(`${tag}${params.note}`)}</p>`);
				return {
					content: [
						{
							type: "text",
							text: `${identifierOf(project, item)}에 진행 코멘트 기록함${params.agent ? ` (agent:${params.agent})` : ""}`,
						},
					],
					details: { project_id: project.id, work_item_id: item.id, identifier: identifierOf(project, item) },
				};
			},
		},
		{
			name: "amaze_contract_set",
			label: "Amaze: 계약 등록",
			description:
				"Register/update an amaze success-criteria contract: write .omp/amaze/<task_key>.json (criteria upserted by id, evidence preserved) and find-or-create the Plane work item with the contract as its start comment (absorbs plane_task_start). Arms the session-stop continuation gate unless enforce=false (plane_task_note blocker:true also disarms). Then: amaze_evidence for proof, amaze_status for progress, plane_task_complete to close (gated).",
			parameters: z.object({
				task_key: z.string().describe("Stable contract identifier — used as Plane external_id and the local filename."),
				objective: z.string().describe("One-sentence goal — becomes the work item name/description."),
				tier: z.enum(["LIGHT", "HEAVY"]),
				criteria: z
					.array(
						z.object({
							id: z.string().optional().describe("Auto-assigned c1, c2… when omitted."),
							scenario: z.string().describe("The literal command / page action / payload."),
							observable: z.string().describe("Single binary observation deciding PASS/FAIL."),
							proof: z
								.enum(["red-green", "review"])
								.optional()
								.describe("Default red-green (failing-first enforced). Use review only for pure prose changes with no machine consumer."),
						}),
					)
					.min(1),
				repo: z.string().optional().describe("Repo/project name override; defaults to cwd basename."),
				enforce: z
					.boolean()
					.optional()
					.describe("Default true: unproven criteria force continuation at session stop. False tracks only, no gate."),
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
				"Record evidence for a criterion; transitions enforced in code: red/green/surface require artifact_path (existing non-empty file under cwd/tmp/~/.omp); GREEN rejected without RED (failing-first), SURFACE rejected before GREEN, proof=review goes straight to SURFACE; cleanup requires a note. No Plane round-trip — free at high frequency.",
			parameters: z.object({
				task_key: z.string(),
				criterion_id: z.string(),
				kind: z.enum(["red", "green", "surface", "cleanup"]),
				artifact_path: z.string().optional().describe("Evidence artifact file path; required for red/green/surface."),
				note: z.string().optional().describe("One-line gist; required for cleanup receipts."),
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
				"One-call local contract summary: per-criterion status, evidence paths, unproven list. Use after compaction/session resume instead of re-reading the notepad. Omit task_key for the most recently updated open contract.",
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
