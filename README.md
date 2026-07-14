# amaze-omp

omp용 **마켓플레이스 플러그인**. lazycodex/ultrawork의 증거 기반 실행 규율 + hyperplan의 적대적 계획을, **omp 코어를 수정하지 않고** 하나의 설치형 플러그인으로 묶었다. Plane을 프로젝트 메모리(마일스톤)로 결합한다.

## 무엇이 들어있나

`plugins/amaze/`:

- `skills/amaze/SKILL.md` — 워크플로우 계약. 티어 판정(LIGHT/HEAVY) → 성공기준 계약 → durable notepad → 발견 wave → (선택)적대적 계획 → `PIN→RED→GREEN→SURFACE→CLEAN` 루프. **기존 omp 서브에이전트(scout/plan/review/librarian)를 `task`로 오케스트레이션**하며 새 에이전트를 정의하지 않는다.
- `tools/plane-bridge.ts` — `plane_task_start/note/complete/lookup/block` 커스텀 툴. Plane REST를 직접 호출(MCP 스키마 비용 0). 작업 기억을 워크아이템으로 남긴다.
- `hooks/post/amaze-status.ts` — Plane 백엔드 준비 상태를 푸터에 표시하는 저위험 훅.

## 설계 원칙

- **omp 무수정**: 코어/config를 건드리지 않는다. 마켓플레이스 설치만으로 skill+hook+tools가 로드된다.
- **2-tier 메모리**: Plane 워크아이템(거친 마일스톤, 영속·사람 가시) + 로컬 notepad(미세·고빈도).
- **lean**: lazycodex의 publish/마켓플레이스 sync CI, team_mode 전용 인프라는 오버스펙이라 제외.

## 설치

```
omp plugin marketplace add steve-8000/amaze-omp
omp plugin install amaze@amaze-omp
```

새 omp 세션에서 `amaze` 또는 `/amaze <목표>`로 트리거하면 스킬이 활성화된다. (마켓플레이스 설치는 `omp.extensions` 모듈을 로드하지 않으므로, 이 플러그인은 그 메커니즘에 의존하지 않는다.)

## Plane 환경변수

`plane_task_*` 툴은 아래를 요구한다:

```
PLANE_API_KEY, PLANE_BASE_URL (기본 https://plane.example.com), PLANE_WORKSPACE_SLUG (기본 my-workspace)
```

## 참고: plane-bridge 단일 소스

이 플러그인은 `plane-bridge.ts`를 소유한다. 과거 `~/.omp/agent/tools/plane-bridge.ts`에 네이티브 복사본이 있었다면, **툴 이름 충돌(중복 등록 거부)**을 피하려고 제거해야 한다. 이 플러그인 설치 시 네이티브 복사본이 없어야 한다.

## task_key 컨벤션

- 기본: 목표의 kebab 슬러그(`amaze-jwt-refresh`).
- 기능 브랜치면 `<branch>::<slug>` 허용.
- 같은 작업 재개 시 같은 key → 같은 워크아이템을 이어받는다(`plane_task_lookup`).
