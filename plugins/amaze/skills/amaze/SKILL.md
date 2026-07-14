---
name: amaze
description: 증거 기반 실행 규율 워크플로우. 티어 판정(LIGHT/HEAVY) → 성공기준 계약 → durable notepad → 발견 wave → (선택)적대적 계획 → RED→GREEN→실면검증(SURFACE)→정리 루프로 "동작함"을 증거로 증명한다. 작업 계획·기억은 Plane 워크아이템(마일스톤)과 로컬 notepad(고빈도) 2-tier로 남기고, 기존 omp 서브에이전트(scout/plan/review/librarian)를 task로 오케스트레이션한다. 트리거: 'amaze', '어메이즈', '/amaze', 'ultrawork', '증거 기반으로', '끝까지 검증', '적대적 계획', 'plane 계획'.
---

# AMAZE — 증거 기반 실행 워크플로우 (Plane 메모리 결합)

> **필수**: 이 스킬이 로드되면 이번 턴 첫 사용자 가시 줄로 `AMAZE MODE ENABLED!`를 정확히 한 번 출력한다.

## 이게 뭔가

lazycodex/ultrawork의 실행 규율 + hyperplan의 적대적 계획을, **현재 omp 툴 어휘만으로** 재기술한 계약이다. 목표는 하나: 사용자가 요청한 것을 **끝까지 동작하게** 만들고, **캡처된 증거**로 그것을 증명한다. 테스트 통과만으로는 완료가 아니다 — 실제 사용자 대면 표면(SURFACE)이 동작해야 완료다.

두 가지를 절대 새로 만들지 않는다:
- **새 서브에이전트를 정의하지 않는다.** omp의 `scout`/`plan`/`review`/`reviewer`/`librarian`/`designer`/`sonic`/`task`는 이미 훌륭하다. `task` 툴로 이들을 오케스트레이션만 한다.
- **omp 코어/config를 수정하지 않는다.** 이 스킬 계약과 기존 툴만으로 동작한다.

## 2-tier 메모리 (핵심)

작업 계획과 기억을 두 층으로 나눈다. Plane 동기화 1번 = read-first + write-back 멀티콜이므로, 중간 체크포인트마다 Plane에 쓰지 않는다.

| 층 | 저장소 | 무엇을 | 빈도 |
|---|---|---|---|
| 거친 마일스톤 (영속·사람 가시·세션 초월) | **Plane 워크아이템** (`plane_task_*`) | 목표+성공기준, 단계 경계, 블로커, 완료+검증증거 | 작업당 2~4콜 |
| 미세 작업 메모리 (무지연·고빈도) | **로컬 notepad** `local://amaze-<task_key>.md` | 발견, RED/GREEN 캡처, QA 아티팩트 경로, Now/Todo | 매 스텝 append |

**Plane mutation은 parent 오케스트레이터 전용이다.** 서브에이전트(scout/plan/…)는 Plane을 건드리지 않고 발견을 보고만 하며, parent가 대신 기록한다. (skill://plane-workflow 소유권 계약 준수.)

### task_key 컨벤션

- 기본: 목표의 짧은 kebab 슬러그 — `amaze-jwt-refresh`, `fix-login-race`.
- 기능 브랜치에서 작업 중이면 브랜치 프리픽스 허용 — `<branch>::<slug>`.
- 사람이 읽고 `plane_task_lookup`로 다시 찾을 수 있게 안정적으로 유지한다. 같은 작업을 재개하면 **같은 key**를 써서 같은 워크아이템을 이어받는다.

## 실행 단계

### 0. 활성화 + 재개 확인
1. `AMAZE MODE ENABLED!` 한 번 출력.
2. `plane_task_lookup`으로 이 레포에 이미 추적 중인 작업이 있는지 확인한다. 이어가는 작업이면 그 워크아이템 코멘트 히스토리를 메모리로 읽고, 로컬 notepad가 있으면 재독한다.

### 1. 티어 판정 (LIGHT / HEAVY) — 한 번, 위로만 상향
변경 집합이 **이번 세션이 직접 편집·실행할 것** 기준. 위임하는 작업은 payload이지 이 세션의 프로세스 크기가 아니다.
- 기본 **LIGHT**: 알려진 패턴을 따르는 딜리버러블(원스팟 버그픽스, 기존 패턴 따르는 엔드포인트, 검증 규칙, 쿼리 조정, 카피/상수, 다른 세션 런치·스티어링).
- **HEAVY**로 올리는 사실이 하나라도 있으면 즉시 상향: 새 모듈/레이어/도메인 모델/추상화; 인증·보안·세션·권한 코드; 외부 연동(API/큐/결제/웹훅) 구축·변경; DB 스키마/마이그레이션; 동시성·트랜잭션 경계·캐시 무효화; 도메인 경계를 넘는 리팩터; 또는 사용자가 신중함을 요청("신중히", "철저히", "설계 먼저")하거나 이 세션 작업 리뷰를 요구.
- 불확실하면 HEAVY. 중간에 HEAVY 사실이 나오면 즉시 상향하고 LIGHT에서 건너뛴 걸 보강한다. 절대 하향 안 함. notepad에 티어+한줄 근거 기록.

### 2. 성공기준 계약 (바인딩 goal)
1. `plane_task_start(task=목표+성공기준, task_key)`로 Plane 워크아이템을 등록한다 — 이게 이 실행의 바인딩 계약이다.
2. `todo init`으로 실행 체크리스트를 만든다(1개만 in_progress 유지).
3. 각 기준은 **정확한 시나리오**를 명시: 리터럴 명령/페이지 액션/페이로드 + PASS/FAIL 이진 관측점 + 캡처할 증거 아티팩트 경로. LIGHT 1~2개(happy + 최대 리스크 엣지), HEAVY 3개+(happy / 엣지: 경계·빈값·malformed·동시 / 인접 표면 리그레션 — 파일+함수로 지목).
4. 각 기준마다 **failing-first** 증거(테스트 id 또는 시나리오)를 구현 전에 RED로, 후에 GREEN으로 캡처한다고 명시. 그린 코드 후에 붙인 증거는 무효.

### 3. durable notepad
`write local://amaze-<task_key>.md` — 섹션: Plan / 성공기준 / Now / Todo / Findings / Learnings. **append-only.** 컨텍스트 손실(compaction 등) 시 전체 재독 후 `## Now`부터 재개.

### 4. 발견 wave (병렬 우선)
기억에서 추측 금지 — 도구로 찾고, 주장/변경 전 재독. 한 번에 3개+ 독립 조회 병렬.
- `codegraph_explore`(있으면 how/where/what/flow에 우선) → 없으면 `grep`/`glob`/`lsp`.
- 심볼(정의/참조/리네임 영향/진단)은 `lsp`.
- 구조 패턴/코드모드는 `ast_grep`/`ast_edit`.
- 미지의 레이아웃은 `task`(`agent:scout`) **병렬** 스폰. 외부 API/문서 리서치는 `task`(`agent:librarian`).

### 5. (선택) 적대적 계획 — hyperplan 경량판
열린 설계결정이 남을 때만(불명확한 모듈 경계, 여러 유효한 분해, 자명하지 않은 의존 순서). 아니면 notepad에서 직접 계획.
1. `task`로 **scout를 5역할로 병렬** 스폰 — skeptic(과단순·오버엔지니어링 공격) / validator(엣지·블라스트반경) / researcher(증거 요구, file:line) / architect(결합·추상화 누수) / creative(대안 프레이밍). 각자 3~7개 numbered findings.
2. findings 번들을 교차 전달해 2라운드째 서로 공격(`irc` 또는 parent가 재분배).
3. parent가 **생존 인사이트만 증류**(반박 성공/미공격/강화된 것) → conceded는 버림.
4. 증류 번들을 `task`(`agent:plan`)에 넘겨 실행 계획으로 **위임**한다. parent가 계획을 직접 쓰지 않는다(hyperplan 계약). 나온 계획을 `plane_task_note`로 워크아이템에 기록.

### 6. 실행 루프 — PIN → RED → GREEN → SURFACE → CLEAN
모든 성공기준이 증거와 함께 PASS할 때까지:
1. 다음 기준 선택 → todo in_progress → notepad `## Now` 갱신.
2. **PIN + RED**: 기존 동작을 건드리면 먼저 특성화 테스트로 핀(변경 전 통과). 그다음 가장 싼 충실 채널로 실패 증거 캡처(시임 있으면 유닛, 배선이면 통합/e2e, 시임 없으면 기준의 실면 시나리오를 실패로). 올바른 이유로 실패해야 함. RED 출력을 notepad에. 아직 프로덕션 코드 없음. **순수 프로즈(프롬프트/SKILL/룰/md)는 시임 없음 → 리뷰+읽기 QA로, 텍스트 grep 핀 금지.**
3. **GREEN**: RED→GREEN을 뒤집는 최소 프로덕션 변경. 재실행해 GREEN 캡처. GREEN이 기준보다 훨씬 크면 증거가 너무 거침 → 쪼갠다.
4. **SURFACE**: 기준이 지정한 실면 증거를 end-to-end로 직접 실행 — HTTP는 `bash`(`curl -i`), 서비스/TUI는 `launch`, 실페이지는 `browser`(실제 클릭/입력), GUI는 `debug`/computer-use. CLI·데이터형 기준은 보조 표면(stdout/DB diff/파싱된 config)이 1급 증거. `--dry-run`·"동작할 것"·"괜찮아 보임"은 증거 아님. 아티팩트 경로를 notepad에.
5. **CLEAN (짝지음·생략 금지)**: QA가 스폰한 런타임 자원은 이 스텝 완료 전 전부 teardown + receipt(서버 PID kill, `launch` stop, 브라우저 컨텍스트 close, 임시 파일 rm). receipt 없으면 기준 in_progress 유지.
6. **검증**: 변경 파일 `lsp` 진단 클린 + 관련 테스트 그린(이번 턴에 skip/xfail 추가 없음).
7. 완료 마킹, 비자명 findings/learnings append. 증분마다 모든 기준 시나리오 재실행.

병렬: 스텝 내 독립 read/search/subagent는 배치. 같은 기준의 RED와 GREEN은 절대 병렬 금지.

### 7. 완료 + 정리
1. 모든 기준 PASS + 증거 확인 후 `plane_task_complete(summary=변경+검증방법, task_key, needs_review?)`. 아직 리뷰 필요하면 `needs_review:true`.
2. 스캐폴딩/데드코드 제거, notepad Learnings 마무리.
3. HEAVY면 `task`(`agent:review`)로 독립 리뷰 후 무조건 승인까지 반복.
4. 블로커 발생 시 `plane_task_block(reason, task_key)`로 사람에게 드러낸다(상태는 안 건드림).

## 안티패턴
| 안티패턴 | 왜 실패하나 |
|---|---|
| 새 서브에이전트 정의 | omp 기존 에이전트로 충분. 계약 위반. |
| Plane을 서브에이전트가 mutation | 소유권은 parent 전용. |
| 매 스텝 Plane 동기화 | 동기화=멀티콜. 마일스톤만. 고빈도는 로컬 notepad. |
| 테스트 그린=완료 선언 | SURFACE 증거 없으면 미완료. |
| RED 없이 GREEN | failing-first 증거가 계약. |
| Phase 5에서 parent가 계획 작성 | plan 에이전트 위임이 hyperplan 계약. |
| 티어 하향 | 상향만. 불확실하면 HEAVY. |
