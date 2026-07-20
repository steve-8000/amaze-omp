// redactScan의 관찰 가능한 계약을 방어한다: 고신뢰 시크릿 패턴은 [REDACTED]로
// 치환하고, 정상 텍스트(한글 포함)는 무손상으로 통과시킨다.
import { describe, expect, test } from "bun:test";
import { redactScan } from "../tools/plane-bridge";

describe("redactScan: 시크릿 탐지", () => {
	test("GitHub 토큰을 redact한다", () => {
		const out = redactScan("push token ghp_abcdefghijklmnopqrstuvwxyz0123456789 사용함");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
	});

	test("AWS access key를 redact한다", () => {
		const out = redactScan("key=AKIAABCDEFGHIJKLMNOP");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("AKIAABCDEFGHIJKLMNOP");
	});

	test("Bearer 토큰을 redact한다", () => {
		const out = redactScan("Authorization: Bearer abcDEF123.token-value_here");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("abcDEF123.token-value_here");
	});

	test("private key 블록을 redact한다", () => {
		const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----";
		const out = redactScan(`설정: ${pem}`);
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("MIIBOgIBAAJBAK");
	});

	test("password=값 형태를 redact한다", () => {
		const out = redactScan("db config: password=hunter2live");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("hunter2live");
	});

	test("언더스코어가 붙은 환경변수 스타일 시크릿도 redact한다 (DB_PASSWORD, client_secret)", () => {
		expect(redactScan("DB_PASSWORD=hunter2live")).not.toContain("hunter2live");
		expect(redactScan("client_secret=abcDEF123xyz")).not.toContain("abcDEF123xyz");
	});

	test("OpenAI 스타일 sk- 키를 redact한다", () => {
		const out = redactScan("key: sk-abcdefghijklmnopqrstuvwxyz");
		expect(out).toContain("[REDACTED]");
		expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
	});

	test("Slack 토큰과 GitHub fine-grained PAT을 redact한다", () => {
		expect(redactScan("xoxb-1234567890-abcdefghij")).toContain("[REDACTED]");
		expect(redactScan("github_pat_11ABCDEFGHIJKLMNOPQRSTU")).toContain("[REDACTED]");
	});

	test("HTML로 감싼 값도 다음 태그를 먹지 않고 값만 redact한다 (addComment sink 안전성)", () => {
		const html = "<p><b>완료</b>: password=abc123secretvalue</p>";
		const out = redactScan(html);
		expect(out).toContain("[REDACTED]");
		expect(out).toContain("</p>");
		expect(out).not.toContain("abc123secretvalue");
	});
});

describe("redactScan: 무손상 통과", () => {
	test("일반 한글 진행 코멘트는 그대로 통과한다", () => {
		const text = "완료: 로그인 버그 수정";
		expect(redactScan(text)).toBe(text);
	});

	test("시크릿 키워드가 없는 일반 영문 문장은 그대로 통과한다", () => {
		const text = "Implemented the retry logic and added a unit test.";
		expect(redactScan(text)).toBe(text);
	});

	test("식별자 중간의 'sk-' 부분 문자열은 redact하지 않는다 (좌측 경계 검사)", () => {
		const text = "브랜치: task-6f8a9b0c1d2e3f4a5b6c";
		expect(redactScan(text)).toBe(text);
	});

	test("Bearer 뒤에 짧은 영단어가 오면 redact하지 않는다 (최소 길이로 평문 오탐 방지)", () => {
		const text = "Bearer tokens expire after 1 hour.";
		expect(redactScan(text)).toBe(text);
	});
});
