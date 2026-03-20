# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [0.10.2] - 2026-03-20

고정 모듈의 프롬프트 변형 지원 — 슬롯에 지정된 변형이 고정 모듈에도 적용됩니다.

### Fixed

- **고정 모듈 프롬프트 변형 미적용**: 슬롯에 `promptVariant`를 지정해도 고정 모듈(`prefixModuleIds`)의 아이템이 항상 기본 프롬프트만 사용하던 문제 수정. 이제 고정 모듈 아이템에 해당 변형이 등록되어 있으면 변형 프롬프트를 사용하고, 없으면 기본 프롬프트로 폴백

## [0.10.1] - 2026-03-20

배치 작업 수정/복제 시 '추가 텍스트' 필드에 고정 모듈 내용이 혼입되는 버그 수정.

### Fixed

- **배치 수정/복제 시 고정 모듈 텍스트 혼입**: 배치 저장 시 고정 모듈(prefixModuleIds)의 합성 텍스트가 `prefixText`에 직접 병합된 채 DB에 저장되어, 수정/복제 시 '추가 텍스트'란에 고정 모듈 내용이 표시되고 재저장 시 내용이 누적 중복되던 문제 수정
  - 원인: `handlers.ts`의 `BATCH_CREATE`에서 `slot.prefixText`를 변형한 config를 그대로 DB에 저장
  - 수정: 변형 전 원본을 `userPrefixText` 필드에 보존하고, 복원 시 `userPrefixText`를 우선 사용. 기존 작업은 `prefixText`로 폴백 (하위 호환)

## [0.10.0] - 2026-03-20

Danbooru 태그 검증 MCP 도구 — LLM이 이미지 생성 프롬프트 작성 시 유효한 Danbooru 태그를 사용하도록 검증·검색·참조 도구 제공.

### Added

- **MCP 태그 검증 도구 (`validate_danbooru_tags`)**: 태그 목록의 유효성을 로컬 DB(6,549개) + Danbooru API로 검증. 무효 태그에 대해 Levenshtein 편집 거리 기반 유사 태그 자동 추천
- **MCP 태그 검색 도구 (`search_danbooru_tags`)**: 키워드·와일드카드로 Danbooru 태그 검색. 로컬 우선 + 온라인 보충. 카테고리 필터 지원
- **MCP 인기 태그 도구 (`get_popular_danbooru_tags`)**: 사용 빈도순 인기 태그 조회. `group_by_semantic=true`로 의미별 그룹화 (hair_color, eye_color, clothing, pose 등)
- **MCP 프롬프트 템플릿 (`danbooru_tag_guide`)**: Danbooru 태그 작성 규칙, 카테고리별 인기 태그 예시, 검증 워크플로우 안내를 LLM에게 자동 제공
- **태그 서비스** (`src/main/services/tags/`): 로컬 태그 DB 로드, 검색, 검증, 유사 추천 + Danbooru REST API 폴백 클라이언트
- **태그 서비스 테스트**: 28개 테스트 케이스 추가 (총 187개)

## [0.9.1] - 2025-07-24

ComfyUI 과부하 근본 원인 수정 — WebSocket 기반 완료 감지로 REST 폴링 제거, 프리뷰 쓰로틀링, 프롬프트 변형 편집 버그 수정.

### Changed

- **WebSocket 기반 완료 감지**: `waitForCompletion()`이 매 1초 REST `/history` 폴링 대신 WebSocket `executionComplete`/`executionError` 이벤트를 활용
  - 28장 배치 기준: 기존 ~840회 HTTP 요청 → 28회(완료 확인용)로 대폭 절감
  - WebSocket 연결 끊김 시 자동으로 REST 폴링 폴백 (5초 간격)
- **프리뷰 이미지 쓰로틀링**: 500ms 간격으로 프리뷰 전송 제한 (매 프레임 base64 변환 방지)

### Fixed

- **프롬프트 변형 편집 버그**: 기존 변형이 있는 아이템을 편집하면 빈 변형이 무한 생성되던 문제 수정
  - 원인: `MODULE_ITEM_LIST` 핸들러가 `prompt_variants`를 JSON 문자열 그대로 전달 → `Object.entries(string)` 실행
  - 수정: 핸들러에서 `parsePromptVariants()` 적용하여 객체로 변환 후 전달
- **모듈 아이템 생성 시 변형 직렬화**: `MODULE_ITEM_CREATE` 핸들러에서 `prompt_variants` 객체를 JSON 문자열로 정상 직렬화

## [0.9.0] - 2025-07-24

지연 태스크 생성(Lazy Task Expansion) — 배치 생성 시 수천 개 태스크를 사전 생성하지 않고 실행 시점에 동적으로 생성하여 메모리와 DB 부하를 극적으로 절감.

### Changed

- **지연 태스크 생성**: 배치 생성 시 설정(config)과 모듈 데이터 스냅샷만 저장하고, 태스크는 실행 시점에 청크(50개) 단위로 동적 생성
  - 4160개 태스크 배치: 기존 ~15-25MB 사전 할당 → 실행 시 ~0.5MB만 사용
  - DB INSERT: 기존 4160개 일괄 → 실행 중 한 건씩 Just-In-Time 삽입
- **모듈 데이터 스냅샷**: 배치 생성 시 모듈/아이템 상태를 `module_data_snapshot`으로 동결 저장 (배치 생성 후 모듈 수정/삭제해도 실행에 영향 없음)
- **완료 태스크 프롬프트 데이터 정리**: 완료된 태스크의 `prompt_data`를 `{}`로 비워 DB 공간 절약
- **하위 호환성**: 기존(v0.8.1 이하) 배치 작업은 레거시 경로로 정상 실행

### Added

- **DB 스키마**: `batch_jobs` 테이블에 `module_data_snapshot TEXT` 컬럼 추가
- **새 함수**: `expandBatchToTasksChunk()` — 인덱스 범위에 대한 태스크만 선택적 생성
- **새 함수**: `countTotalTasksFromData()` — 전체 태스크 수 사전 계산 (태스크 생성 없이)
- **Repository**: `BatchTaskRepository.createSingle()`, `countProcessedByJob()`, `clearPromptDataForCompleted()` 추가
- **테스트**: 지연 태스크 생성 관련 7개 테스트 케이스 추가 (총 159개)

## [0.8.1] - 2025-07-24

대량 배치 실행 최적화 — ComfyUI 메모리 절감, 청크 기반 처리, ETA 표시.

### Changed

- **청크 기반 태스크 처리**: 전체 태스크를 한 번에 메모리 로드 → 50개씩 청크 단위로 로드하여 처리 (앱 메모리 대폭 절감)
- **ComfyUI 히스토리 자동 정리**: 각 이미지 다운로드 완료 후 해당 히스토리 항목 자동 삭제 → ComfyUI 서버 메모리 누적 방지
- **DB 트랜잭션 최적화**: `createBulk()` 대량 삽입을 `BEGIN`/`COMMIT` 트랜잭션으로 감싸서 삽입 속도 개선
- **실시간 ETA 표시**: 실행 중인 작업의 남은 시간 예측 (완료된 태스크 평균 소요 시간 기반)
- **진행 상태 바 개선**: 작업 실행 상태 바에 남은 시간 표시 추가

## [0.8.0] - 2025-07-24

슬롯별 프롬프트 변형(Prompt Variants) 기능 추가. 같은 모듈 아이템에 대해 슬롯마다 다른 프롬프트를 사용 가능.

### Added

- **프롬프트 변형**: 모듈 아이템에 이름 기반 프롬프트 변형(named variant) 추가 가능
  - 예: 캐릭터 "앨리스" 아이템에 "자연어" 변형과 "태그" 변형을 각각 등록
  - 모듈 아이템 편집 모달에 변형 추가/삭제/편집 섹션 추가
- **슬롯별 변형 선택**: 배치 위자드 슬롯 매핑에서 프롬프트 변형 지정 가능
  - anima 슬롯 → "자연어" 변형, ilxl 슬롯 → "태그" 변형 등
  - 변형 미지정 시 기본 프롬프트로 자동 폴백
- **DB 스키마**: `module_items` 테이블에 `prompt_variants` 컬럼 추가 (JSON 형식)
- **테스트**: 프롬프트 변형 관련 6개 테스트 케이스 추가 (총 152개)
- **MCP 도구 업데이트**: `create_module_item`/`update_module_item`에 `prompt_variants` 파라미터 추가, `create_batch_job`에 `slot_mappings` + `promptVariant` 지원

### Fixed

- **MCP 세션 메모리 누수**: 세션 타임아웃(30분) + 최대 세션 수(10개) 제한 + LRU 퇴출로 메모리 누수 방지

## [0.7.1] - 2025-07-24

MCP 서버 버그 수정 및 멀티 CLI 호환성 개선.

### Fixed

- **MCP 서버 세션 관리**: `onsessioninitialized` 콜백으로 세션 저장 타이밍 수정 (SDK 공식 예제 패턴 적용). `sessionId`가 `handleRequest()` 중에 생성되므로, 기존 코드는 세션을 저장하지 못해 모든 요청이 실패했음
- **`require()` 번들링 오류**: `handlers.ts`의 동적 `require()` 3곳을 정적 import로 교체 (electron-vite 빌드 후 MODULE_NOT_FOUND 해결)
- **`.mcp.json` 형식 수정**: `type: "url"` 제거 → 표준 `{ url: "..." }` 형식 (Copilot CLI/Claude Code 호환)

### Added

- **Gemini CLI 지원**: `~/.gemini/settings.json`에 `type: "http"` 형식으로 자동 설정
- **Codex CLI 지원**: `~/.codex/config.toml`에 TOML 형식으로 자동 설정
- **멀티 CLI 상태 표시**: 설정 페이지 + 터미널 배너에서 CLI별 설정 상태 확인 (Claude Code ✓, Gemini CLI ✓, Codex CLI ✓)

## [0.7.0] - 2026-03-20

MCP 서버와 내장 터미널 추가. LLM CLI(Copilot CLI, Claude CLI 등)가 MCP 도구를 통해 앱 기능을 프로그래밍적으로 제어 가능.

### Added

- **MCP 서버**: Streamable HTTP 전송 방식으로 15개 핵심 도구 제공
  - 모듈 관리: `list_modules`, `get_module`, `create_module`, `update_module`, `delete_module`
  - 모듈 아이템: `list_module_items`, `create_module_item`, `update_module_item`, `delete_module_item`
  - 워크플로우: `list_workflows`, `get_workflow`
  - 배치 작업: `create_batch_job`, `start_batch_job`, `list_batch_jobs`, `get_batch_job`
- **내장 터미널**: node-pty + xterm.js 기반 풀 PTY 터미널
  - 멀티 탭 지원
  - 전용 페이지 (`/terminal`) + 하단 패널 모드 전환
  - 드래그로 패널 높이 조절
- **설정 페이지**: MCP 서버 활성화 토글, 포트 설정, 상태 표시, URL 복사
- **CLI 자동 연결**: 터미널에서 LLM CLI 실행 시 MCP 도구 자동 연결
  - 환경 변수 자동 주입 (`COMFYUI_MCP_URL`, `MCP_ENDPOINT`)
  - Claude Code용 `.mcp.json` 자동 생성/관리
  - 터미널 웰컴 배너에 MCP 연결 정보 표시
- **네비게이션**: 사이드바에 터미널 메뉴 추가, 헤더에 터미널 패널 토글 버튼
- **IPC 채널**: 터미널 6개 (`terminal:create/input/resize/destroy/data/exit`), MCP 6개 (`mcp:start/stop/status/config-status/setup-cli/remove-cli`)

### Changed

- **앱 브랜딩**: 앱 이름 `Electron` → `ComfyUI Asset Manager`, 커스텀 아이콘 적용 (모든 플랫폼)
- `electron-builder.yml`: `appId`, `productName`, `executableName`을 프로젝트에 맞게 변경
- `electron-builder.yml`: `npmRebuild: true`, node-pty `asarUnpack` 추가
- `package.json`: `@modelcontextprotocol/sdk`, `node-pty`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links` 의존성 추가
- 페이지 구조 4+1 → 5+1 (터미널 페이지 추가)

## [0.6.1] - 2026-03-20

드래그 앤 드롭 정렬 기능 추가.

### Added

- **모듈 아이템 드래그 정렬**: 모듈 내 아이템을 드래그 핸들(⠿)로 순서 변경 가능
- **고정 모듈 드래그 정렬**: 배치 위자드의 프롬프트 슬롯에서 고정 모듈 태그를 드래그하여 순서 변경 (프롬프트 합성 순서에 직접 영향)
- **작업 카드 드래그 정렬**: 작업 목록의 카드를 드래그하여 우선순위 변경 가능

### Changed

- `batch_jobs` 테이블에 `sort_order` 컬럼 추가 (마이그레이션)
- 고정 모듈 선택 UI를 NSelect multiple → NSelect(추가) + 드래그 가능 태그 리스트로 변경

## [0.6.0] - 2026-03-19

UI 리디자인 — 7페이지 구조를 4+1로 간소화하고, 배치/큐를 통합한 "작업" 페이지 도입.

### Changed

- **네비게이션 간소화**: 7페이지 → 4+1 (워크플로우, 모듈, 작업, 갤러리 + 설정)
- **대시보드 제거**: 연결 상태를 상단 헤더 바로 이동
- **배치 + 큐 통합**: 새로운 "작업(Jobs)" 페이지 — 실행 상태 바 + 작업 카드 그리드
- **배치 마법사 리디자인**: 880줄 7섹션 모달 → 3단계 위자드 (기본 설정 → 모듈 & 프롬프트 → 확인)
- **워크플로우 뷰 간소화**: 변수 값 편집(모델/LoRA/샘플러 드롭다운) 제거, 역할 설정만 유지
- **모듈 뷰 개선**: 카드 그리드 레이아웃, 필 스타일 필터 버튼
- **갤러리 뷰 개선**: 콤팩트 필터 바, 부드러운 카드 스타일 (둥근 모서리)
- **전역 스타일 통일**: border-radius 12px, 부드러운 트랜지션, 호버 효과, 소프트 스크롤바
- **프롬프트 슬롯 매핑 간소화**: 4개 입력 → 3개 (고정 모듈 + 조합 모듈 + 추가 텍스트)

### Removed

- `DashboardView` — 대시보드 페이지 제거 (연결 상태는 헤더로 이동)
- `BatchView`, `QueueView` — 배치/큐 개별 페이지 제거 (JobsView로 통합)
- 워크플로우 변수 값 편집 UI (모델/LoRA/샘플러 드롭다운, LoRA 가중치 슬라이더)
- 프롬프트 슬롯 매핑의 서픽스 입력 필드

## [0.5.2] - 2026-03-19

갤러리 이미지 로딩 수정, 배치 작업 편집 및 재실행 기능 추가.

### Fixed

- **갤러리 이미지 로딩**: Windows 백슬래시 경로를 `file:///` URL로 변환하여 이미지가 정상 표시됨

### Added

- **배치 작업 수정**: "수정" 버튼으로 기존 배치 작업의 설정을 편집 모달에서 수정 가능
  - 모달 제목·버튼 텍스트가 "수정" 모드로 전환
  - 저장 시 기존 작업을 삭제하고 새 작업으로 대체
- **배치 작업 재실행**: "재실행" 버튼으로 완료/실패한 작업을 즉시 재실행
  - 모든 태스크가 pending으로 리셋 후 자동 시작
  - 복제 없이 원클릭 재실행

### Changed

- `BatchTaskRepository`에 `deleteByJob()`, `resetByJob()` 메서드 추가
- `BATCH_RERUN` IPC 채널 추가
- 배치 작업 테이블 액션: 수정 / 재실행 / 복제 / 삭제 4개 버튼

## [0.5.1] - 2026-03-19

모듈 기반 프리픽스 선택 — 고정 프리픽스를 수동 입력 대신 기존 모듈에서 선택 가능.

### Added

- **고정 모듈 프리픽스**: 각 프롬프트 슬롯에서 NSelect 다중 선택으로 품질/스타일/아티스트 등 기존 모듈을 프리픽스로 지정
  - 선택한 모듈의 아이템이 자동으로 합성되어 프롬프트 앞부분에 추가
  - 수동 텍스트 입력과 병행 가능 (모듈 합성 텍스트 + 수동 텍스트 순서)
- **슬롯 UI 재구성**: 프리픽스 모듈 선택 → 추가 텍스트 입력 → 매트릭스 모듈 체크박스 → 서픽스 입력 순서로 직관적 배치

### Changed

- `BatchConfig.slotMappings`에 `prefixModuleIds` 필드 추가
- `GeneratedTask.promptData.slotMappings`에 `prefixModuleIds` 필드 추가
- BATCH_CREATE 핸들러에서 프리픽스 모듈 ID를 합성 텍스트로 변환 후 태스크 생성
- DB에 저장되는 config에는 원본 모듈 ID를 유지하여 배치 복제 시 정확한 복원 가능

## [0.5.0] - 2026-03-19

슬롯별 모듈 매핑 — 프롬프트 슬롯마다 어떤 모듈을 주입할지 개별 설정 가능.

### Added

- **슬롯별 모듈 할당**: 각 프롬프트 슬롯에 매트릭스의 어떤 모듈을 주입할지 체크박스로 선택
  - 예: "아니마 긍정" 슬롯에는 캐릭터+복장+감정, "IL 긍정" 슬롯은 고정값
  - 모듈 미선택 시 전체 합성 프롬프트 사용 (하위 호환)
- **고정 프리픽스/서픽스**: 각 주입 슬롯에 고정 텍스트를 모듈 프롬프트 앞뒤에 추가
  - 예: 프리픽스="masterpiece, best quality, 1girl" + 모듈 프롬프트 + 서픽스
- **슬롯별 프롬프트 합성**: 태스크 생성 시 각 슬롯에 할당된 모듈만으로 개별 프롬프트 합성

### Changed

- `BatchConfig.slotMappings`에 `assignedModuleIds`, `prefixText`, `suffixText` 필드 추가
- `GeneratedTask.promptData`에 `slotPrompts` (슬롯키→합성 프롬프트) 맵 추가
- 큐 매니저가 `slotPrompts`를 우선 사용, 없으면 글로벌 프롬프트로 폴백

## [0.4.0] - 2026-03-19

ComfyUI 리소스 브라우저 + 배치 작업 복제 — 앱에서 직접 모델/LoRA/샘플러 선택 가능.

### Added

- **ComfyUI 리소스 브라우저**: 워크플로우 상세 모달에서 변수 값을 직접 편집
  - 체크포인트(모델): ComfyUI에 설치된 모델 목록에서 필터링 드롭다운 선택
  - LoRA: 설치된 LoRA 목록에서 필터링 드롭다운 선택
  - LoRA 가중치(`strength_model`, `strength_clip`): 슬라이더 + 숫자 입력 (0~2, step 0.05)
  - 시드: 숫자 입력 + 🎲 랜덤 버튼
  - 샘플러/스케줄러: 드롭다운 선택
  - 텍스트/숫자: 적절한 입력 컴포넌트
  - 변경 시 자동 저장 (300ms 디바운스)
- **배치 변수 오버라이드**: 배치 빌더에서 워크플로우 변수를 개별적으로 오버라이드
  - 토글 스위치로 활성화/비활성화
  - 워크플로우 상세와 동일한 타입별 에디터 UI
  - 오버라이드된 값이 배치 실행 시 워크플로우에 적용
- **배치 작업 복제**: 기존 배치 작업의 설정을 복원하여 새 작업 생성
  - 모듈 선택, 슬롯 매핑, 변수 오버라이드 모두 복원
  - 이름에 "(복사)" 접미사 자동 추가
  - 완료/실패한 작업도 복제 가능

### Changed

- `workflow:update-variable-value` IPC 채널 추가
- `BatchConfig` / `GeneratedTask`에 `variableOverrides` 필드 추가
- 큐 매니저가 변수 오버라이드를 워크플로우 노드에 적용

## [0.3.0] - 2026-03-19

프롬프트 슬롯 시스템 도입 — 워크플로우 변수에 역할(role) 기반 프롬프트 주입.

### Added

- **프롬프트 슬롯 시스템**: CLIPTextEncode 노드를 KSampler 연결 추적으로 자동으로 긍정/부정 프롬프트 역할 감지
  - 직접 연결 및 ConditioningCombine 등 간접 연결 모두 지원
  - `_meta.title` 키워드 (긍정/부정, positive/negative) 기반 추가 감지
  - 콘텐츠 기반 휴리스틱 (폴백)
- **역할 편집**: 워크플로우 상세 모달에서 각 변수의 역할을 수동으로 변경 가능
  - 역할: 긍정 프롬프트 / 부정 프롬프트 / 시드 / 고정값 / 사용자 정의
  - 역할별 색상 코드 태그 표시
- **슬롯 매핑 UI**: 배치 빌더에서 워크플로우 선택 시 감지된 프롬프트 슬롯 표시
  - 각 슬롯별 "모듈 프롬프트 주입" / "고정값 사용" 선택 가능
  - 고정값 모드에서 직접 텍스트 입력 가능
- **슬롯 기반 주입**: 큐 매니저가 슬롯 매핑에 따라 정확한 노드에 프롬프트 주입
  - 슬롯 매핑 없는 기존 배치 작업은 레거시 휴리스틱으로 호환 유지

### Changed

- `workflow_variables` 테이블에 `role` 컬럼 추가 (기존 DB 마이그레이션 포함)
- `ParsedVariable` 인터페이스에 `role` 필드 추가
- `BatchConfig` / `GeneratedTask` 인터페이스에 `slotMappings` 필드 추가

## [0.2.5] - 2026-03-19

배치 실행 핵심 버그 수정.

### Fixed

- **이미지 다운로드 실패 (파라미터 순서 오류)**: `getImage(filename, type, subfolder)` → `getImage(filename, subfolder, type)`으로 수정. 파라미터 순서가 뒤바뀌어 ComfyUI에서 이미지를 가져올 수 없었고, 이로 인해 작업이 실패로 표시되고 갤러리에도 이미지가 등록되지 않았음
- **히스토리 완료 판정 개선**: ComfyUI 히스토리 응답의 `status.completed` 및 `status.status_str` 필드를 확인하여 실행 완료/에러를 정확히 감지. 에러 상태일 때 즉시 실패 처리

## [0.2.4] - 2026-03-19

### Fixed

- **배치 작업 생성 시 structuredClone 오류**: BatchView에서 직접 IPC 호출 시 reactive 객체가 전달되던 문제 수정. `toPlain()` 래핑 적용

## [0.2.3] - 2026-03-19

모듈 편집 기능 추가 및 배치 빌더 UX 개선.

### Added

- **모듈 편집 기능**: 모듈 목록에서 이름, 유형, 설명을 수정할 수 있는 편집 버튼 및 모달 추가
- **배치 빌더 안내 메시지**: 모듈 아이템이 없을 때, 모듈 미선택 시 상황별 안내 문구 표시

### Fixed

- **배치 빌더 UUID 표시 오류**: 모듈 추가 NSelect에 `v-model:value` 바인딩이 없어서 선택 후 UUID가 표시되던 문제 수정. 선택 후 값을 자동 초기화하도록 변경
- **배치 작업 0장 혼란**: 아이템이 없는 모듈 추가 시 경고 메시지 표시, 미리보기 영역에 모듈/아이템 선택 안내 추가

## [0.2.2] - 2026-03-19

IPC 직렬화 오류 수정.

### Fixed

- **모듈 생성 실패 (structuredClone 오류)**: Vue reactive proxy 객체가 Electron IPC `structuredClone()`을 통과하지 못하는 문제 수정. `toPlain()` 유틸리티 함수를 만들어 모든 IPC 호출 전에 반응성을 제거
- 영향 범위: module, workflow, gallery 스토어의 create/update 호출 전체에 적용

### Added

- `src/renderer/src/utils/ipc.ts` — `toPlain()` 유틸리티 (Vue reactivity → plain object 변환)

## [0.2.1] - 2026-03-19

UI 버그 수정 3건.

### Fixed

- **프롬프트 모듈 생성 실패**: `NModal preset="dialog"`의 async `@positive-click` 핸들러에서 에러 발생 시 모달이 닫히지 않고 피드백 없이 실패하던 문제 수정. `preset="card"` + 명시적 버튼으로 변경하고 try/catch 에러 메시지 추가
- **워크플로우 변수 목록 오버플로우**: 변수 10개 이상 시 회색 박스를 넘어가는 문제 수정. `max-height: 320px; overflow-y: auto` 스크롤 컨테이너 추가
- **워크플로우 편집 모달 기능 부족**: 유형(카테고리)만 변경 가능하던 편집 모달에 이름·설명 편집 기능 추가. 저장 버튼 추가. 테이블 버튼 레이블 "편집" → "상세"로 변경

### Changed
- `common.detail` i18n 키 추가 (ko: "상세", en: "Detail")

## [0.2.0] - 2026-03-19

테스트 인프라를 추가하여 핵심 비즈니스 로직의 안정성을 확보합니다.

### Added

#### 테스트 프레임워크
- Vitest 테스트 러너 설정 (`vitest.config.ts`)
- `npm test` / `npm run test:watch` / `npm run test:coverage` 스크립트
- 5개 테스트 파일, **146개 테스트 케이스** 전체 통과

#### 프롬프트 조합 엔진 테스트 (34개)
- `applyWeight`: 가중치 적용, 빈 텍스트, 소수점 포맷팅
- `resolveWildcards`: 시드 기반 결정적 선택, 다중 와일드카드, 공백 트리밍
- `interpolateVariables`: 변수 치환, 미정의 변수 보존, 빈 맵 처리
- `combineFragments`: 양성/음성 조합, 가중치 적용, 빈 프래그먼트 스킵
- `buildPrompt`: 모듈 타입 순서, 비활성 아이템 스킵, 네거티브 모듈 처리
- `previewPrompt`: 와일드카드 미해석 확인, 변수 보간만 수행

#### 배치 태스크 생성기 테스트 (23개)
- `cartesianProduct`: 빈 배열, 단일 배열, 다차원 조합
- `calculateTaskCount`: 조합 수 계산, 빈 선택, 다차원 곱
- `resolveOutputPath`: 변수 치환, 특수문자 새니타이즈, 미매칭 변수 보존
- `expandBatchToTasks`: 태스크 수 검증, 메타데이터 추출, 시드 모드 (fixed/incremental), 비활성 필터링

#### 워크플로우 파서 테스트 (23개)
- `parseWorkflow`: KSampler/CLIPTextEncode/EmptyLatentImage 변수 감지, 카테고리 자동 분류 (generation/upscale/detailer/custom), 알 수 없는 노드 타입 추론, 링크 배열 스킵
- `applyVariables`: 변수 값 적용, 미존재 노드 무시, 원본 보존
- `getPromptNodes`: CLIPTextEncode 노드 탐지, 네거티브 프롬프트 휴리스틱 감지

#### 데이터베이스 리포지토리 테스트 (51개)
- 8개 리포지토리 전체 CRUD 테스트 (sql.js in-memory DB 사용)
- `SettingsRepository`: get/set/getAll/delete, 기본값 확인
- `WorkflowRepository`: 생성/조회/수정/삭제, 카테고리 필터, 변수 관리
- `ModuleRepository`: 생성/조회/수정/삭제, 타입 필터
- `ModuleItemRepository`: 아이템 CRUD, 정렬 순서, CASCADE 삭제
- `CharacterRepository`: 알파벳 정렬, CRUD
- `BatchJobRepository`: 상태 관리, 진행률 업데이트
- `BatchTaskRepository`: 벌크 생성, 상태 업데이트, 재시도 카운트, CASCADE 삭제
- `GeneratedImageRepository`: 페이지네이션, 필터링 (캐릭터/평점/즐겨찾기), 정렬, 평점/즐겨찾기 업데이트

#### ComfyUI REST 클라이언트 테스트 (15개)
- `ping`: 성공/실패 시나리오
- `queuePrompt`: POST 요청 검증
- `getHistory`/`getHistoryEntry`: 전체/개별 히스토리 조회
- `getAvailableModels`: object_info에서 모델 목록 추출
- `interrupt`/`deleteFromQueue`/`clearQueue`: 큐 관리 API 호출 검증

### Changed
- `package.json`: 버전 0.2.0, 불필요한 drizzle-kit 스크립트 제거
- `package.json`: vitest, @vitest/coverage-v8, happy-dom, @vue/test-utils 의존성 추가

## [0.1.0] - 2026-03-19

최초 기능 완성 릴리스. ComfyUI 연결부터 대량 이미지 생성·관리까지 전체 파이프라인을 구현합니다.

### Added

#### ComfyUI 연결 (Phase 2)
- ComfyUI REST API 클라이언트 (`/prompt`, `/queue`, `/history`, `/system_stats`, `/object_info`, `/view`, `/upload/image`)
- WebSocket 연결 (실시간 진행률, 실행 완료/에러 이벤트, 미리보기 이미지)
- 자동 재연결 (지수 백오프: 3초 → 최대 30초)
- 서버 연결 상태 모니터링 및 시스템 통계 조회

#### 워크플로우 관리 (Phase 2)
- ComfyUI API 형식 JSON 워크플로우 가져오기
- 자동 변수 감지 (KSampler, CLIPTextEncode, CheckpointLoader 등 알려진 노드 타입)
- 카테고리 자동 분류 (생성 / 업스케일 / 디테일러 / 커스텀)
- 변수 편집 모달 (타입, 기본값, 설명)

#### 프롬프트 모듈 시스템 (Phase 3)
- 9가지 모듈 타입: character, outfit, emotion, style, artist, quality, negative, lora, custom
- 모듈 아이템 CRUD (프롬프트, 네거티브, 가중치, 활성/비활성)
- 프롬프트 조합 엔진 (quality → style → artist → character → outfit → emotion → lora → negative → custom 순서)
- 와일드카드 지원 (`{option1|option2|option3}`, 시드 기반 결정적 선택)
- 변수 보간 (`{{variable_name}}`)
- 실시간 프롬프트 미리보기
- 모듈 내보내기/가져오기 (클립보드 JSON)

#### 배치 작업 시스템 (Phase 4)
- 매트릭스 빌더 UI (모듈 선택 → 아이템 체크박스)
- 카르테시안 곱 태스크 확장 (조합 × 조합당 생성 수)
- 시드 모드: 랜덤, 고정, 증분
- 출력 폴더/파일명 패턴 (`{job}`, `{character}`, `{outfit}`, `{emotion}`, `{index}` 등)
- 총 조합 수 · 총 이미지 수 미리보기
- 대량 작업 경고 (10,000장 초과 시)

#### 큐 관리 & 실행 엔진 (Phase 5)
- 순차 작업 처리 (프롬프트 제출 → 히스토리 폴링 → 이미지 다운로드 → 디스크 저장)
- ComfyUI 워크플로우에 프롬프트·시드 자동 주입
- 일시정지 / 재개 / 취소 지원
- 자동 재시도 (설정 가능한 최대 횟수)
- 작업별 10분 타임아웃
- 실시간 진행률 전송 (WebSocket 이벤트 → 렌더러)

#### 갤러리 (Phase 6)
- 이미지 그리드 뷰 (반응형 2~5열)
- ⭐ 5점 평점 시스템
- ♥ 즐겨찾기
- 정렬 (생성일, 평점) 및 필터 (평점, 즐겨찾기)
- 다중 선택 모드 & 일괄 삭제
- 이미지 상세 모달 (메타데이터, 파일 경로)
- 페이지네이션

#### 대시보드 (Phase 7)
- 서버 연결 상태 표시 (LED 인디케이터)
- 총 이미지 수, 즐겨찾기, 배치 작업, 워크플로우, 모듈 통계
- 최근 생성 이미지 목록 (최대 10개)
- 주요 기능 바로가기 버튼
- 클릭 가능한 통계 카드 (해당 페이지로 이동)

#### 앱 기반 (Phase 1, 8)
- Electron 39 + Vue 3 + Pinia + TypeScript 기반 구조
- sql.js (WASM SQLite) 데이터베이스 (12개 테이블, 디바운스 영속화)
- Naive UI 컴포넌트 라이브러리 (다크/라이트 테마)
- 한국어/영어 i18n 지원
- IPC 양방향 통신 (invoke + event)
- 사이드바 네비게이션 레이아웃 (7개 페이지)
- 앱 시작 시 자동 ComfyUI 연결 시도
- 종료 시 안전한 DB 저장 및 WebSocket 해제
