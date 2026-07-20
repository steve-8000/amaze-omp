// destructive-guard — 파괴적 bash 명령의 결정적 게이트. 프롬프트 지침이 아니라
// 코드로 차단: rm -rf, git reset --hard, force-push, DROP TABLE/DATABASE,
// kubectl delete 같은 고신뢰 패턴을 tool_call 단계에서 잡아 즉시 block한다.
//
// delegation-guard.ts와 동일한 `pi.on("tool_call")` -> `{block, reason}` 관용구.
// node_modules/dist/.next/.cache/build/coverage/.turbo/__pycache__ 아래의
// rm -rf는 일상적인 정리 작업이라 예외로 통과시킨다(gstack의 careful/SKILL.md
// "Safe exceptions" 관용구).
import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const SAFE_DIR_NAMES = ["node_modules", "dist", ".next", "__pycache__", ".cache", "build", ".turbo", "coverage"];

// rm -rf 세그먼트(&&/||/;/|로 나뉜 각 부분)마다 검사한다 — 명령 전체가 아니라
// 개별 rm 호출 각각의 대상이 전부 안전 디렉터리명이어야 예외로 통과시킨다.
// "rm -rf node_modules && rm -rf /" 처럼 안전한 세그먼트 뒤에 위험한 세그먼트가
// 숨어 있으면(세그먼트 하나만 보면 놓친다) 전체를 차단한다.
function isSafeRmCommand(cmd: string): boolean {
	const rmSegments = cmd.split(/&&|\|\||;|\|/).filter((seg) => /\brm\s+-/.test(seg));
	if (rmSegments.length === 0) return false;
	return rmSegments.every((seg) => {
		const m = /^\s*rm\s+(?:-{1,2}[a-zA-Z][a-zA-Z-]*\s+)+(.+)$/.exec(seg.trim());
		if (!m) return false;
		const tokens = m[1].trim().split(/\s+/).filter(Boolean);
		if (tokens.length === 0) return false;
		return tokens.every((t) => {
			const norm = t.replace(/\/\*$/, "").replace(/\/$/, "");
			return SAFE_DIR_NAMES.some((d) => norm === d || norm.endsWith(`/${d}`));
		});
	});
}

// "git push" 세그먼트 안의 토큰 중 -f/--force가 있으면 강제푸시로 본다. 정규식
// 하나로는 "git push origin main --force"(플래그가 뒤에 옴)와 "--force-with-lease"
// (안전한 변형, 오탐이면 안 됨)를 동시에 정확히 가르기 어려워 토큰 단위로 검사한다.
function hasForcePush(cmd: string): boolean {
	const idx = cmd.search(/\bgit\s+push\b/);
	if (idx === -1) return false;
	const rest = cmd.slice(idx);
	const sepIdx = rest.search(/&&|\|\||;|\|/);
	const segment = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
	return segment
		.trim()
		.split(/\s+/)
		.some((t) => t === "-f" || t === "--force");
}

interface DestructivePattern {
	re: RegExp;
	label: string;
}

const DESTRUCTIVE_PATTERNS: readonly DestructivePattern[] = [
	{ re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive\b.*--force\b|--force\b.*--recursive\b)/, label: "rm -rf (재귀 삭제)" },
	{ re: /\bgit\s+reset\s+--hard\b/, label: "git reset --hard (커밋되지 않은 변경 유실)" },
	{ re: /\bgit\s+(checkout|restore)\s+\./, label: "git checkout/restore . (미커밋 변경 유실)" },
	{ re: /\bDROP\s+(TABLE|DATABASE)\b/i, label: "DROP TABLE/DATABASE (데이터 손실)" },
	{ re: /\bTRUNCATE\s+(TABLE\s+)?\S/i, label: "TRUNCATE (TABLE) (데이터 손실)" },
	{ re: /\bkubectl\s+delete\b/, label: "kubectl delete (운영 영향)" },
	{ re: /\bdocker\s+(rm\s+-f|system\s+prune)\b/, label: "docker rm -f / system prune (컨테이너·이미지 삭제)" },
];

const FORCE_PUSH_LABEL = "git push --force (히스토리 재작성)";

/** 명령 문자열에서 매치된 파괴적 패턴 라벨 목록을 반환한다. 순수 함수 — 단위테스트 가능. */
export function matchDestructive(cmd: string): string[] {
	const hits: string[] = [];
	for (const { re, label } of DESTRUCTIVE_PATTERNS) {
		if (!re.test(cmd)) continue;
		if (label.startsWith("rm -rf") && isSafeRmCommand(cmd)) continue; // 안전 예외
		hits.push(label);
	}
	if (hasForcePush(cmd)) hits.push(FORCE_PUSH_LABEL);
	return hits;
}

export default function destructiveGuard(pi: HookAPI): void {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return;
		const cmd = event.input?.command;
		if (typeof cmd !== "string") return;
		const hits = matchDestructive(cmd);
		if (hits.length === 0) return;
		return {
			block: true,
			reason: `파괴적 명령 감지: ${hits.join(", ")}. 의도한 것이 맞는지 확인 후, 필요하면 사용자에게 직접 실행을 요청하거나 더 좁은 명령으로 바꾸세요.`,
		};
	});
}
