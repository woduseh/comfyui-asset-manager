# AGENTS.md — ComfyUI Asset Manager

이 문서는 AI 에이전트가 프로젝트에 기여할 때 참고하는 규칙과 컨벤션입니다.

## 릴리스 규칙

### 시맨틱 버저닝 (SemVer)

버전 형식: `MAJOR.MINOR.PATCH`

- **MAJOR** (x.0.0): 호환되지 않는 변경 (DB 스키마 변경, IPC 채널 제거 등)
- **MINOR** (0.x.0): 새로운 기능 추가 (하위 호환)
- **PATCH** (0.0.x): 버그 수정, 성능 개선, 리팩토링

### 변경 시 필수 업데이트 문서

기능 개선·버그 수정을 커밋할 때 아래 3개 파일을 **반드시** 함께 업데이트합니다:

1. **`AGENTS.md`** — 이 파일. 새로운 컨벤션이나 규칙이 추가되면 반영
2. **`README.md`** — 사용자에게 보이는 기능 설명. 새 기능이면 문서화
3. **`CHANGELOG.md`** — 변경 내역. 해당 버전 섹션에 Added/Changed/Fixed/Removed 기록

### 버전 올리기

1. `package.json`의 `"version"` 필드를 새 버전으로 변경
2. `CHANGELOG.md`에 `## [새버전] - YYYY-MM-DD` 섹션 추가
3. 커밋 메시지: `v{버전}: 간단한 설명` (예: `v0.2.0: Add pipeline system`)

## 코드 컨벤션

### 언어

- 코드: 영어 (변수명, 주석, 커밋 메시지)
- UI 텍스트: 한국어 기본, i18n 키 사용 (`src/renderer/src/locales/`)
- 문서 (README, CHANGELOG): 한국어

### TypeScript

- strict mode 사용
- 2개 tsconfig: `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer)
- 공유 타입은 `src/renderer/src/types/ipc.ts`에 정의
- Vue 파일에서 `<script setup lang="ts">` 또는 `<script lang="ts">`

### IPC 패턴

```typescript
// 1. 채널 상수 추가 — src/main/ipc/channels.ts
export const IPC_MY_FEATURE = 'my-feature:action'

// 2. 핸들러 등록 — src/main/ipc/handlers.ts
ipcMain.handle(IPC_MY_FEATURE, async (_event, args) => { ... })

// 3. 렌더러에서 호출 — Pinia store
const result = await window.electron.ipcRenderer.invoke('my-feature:action', args)
```

### 데이터베이스

- sql.js (WASM SQLite, in-memory)
- 모든 mutation 후 `saveDatabase()` 호출 필수
- Repository 패턴: `src/main/services/database/repositories/index.ts`
- 새 테이블 추가 시 `createTables()` 함수에 `CREATE TABLE IF NOT EXISTS` 추가
- `module_items.prompt_variants`: JSON 컬럼 — `Record<string, { prompt, negative }>` 형식으로 슬롯별 변형 프롬프트 저장
- **Repository 필드 화이트리스트**: `ALLOWED_UPDATE_FIELDS`로 update() 시 허용 필드만 통과. 새 필드 추가 시 화이트리스트에도 반영 필수

### 컴포넌트 & 스토어

- Naive UI 컴포넌트는 개별 import (tree-shaking)
- Pinia 스토어는 Composition API 패턴 (`defineStore(name, setupFn)`)
- 스토어에서 main process와 통신 시 `window.electron.ipcRenderer.invoke()` 사용
- 파괴적 renderer 액션(삭제, 취소 등)은 bare 버튼을 직접 두기보다 `src/renderer/src/components/common/ConfirmActionButton.ts` 같은 재사용 확인 컴포넌트 우선

### IPC 입력 검증

- **검증 유틸리티**: `src/main/ipc/validators.ts` — 모든 새 IPC 핸들러에서 사용
- `validateString(val, maxLen?)` / `validateId(val)` / `validatePositiveInt(val)` / `validateRating(val)`
- `validateSettingsKey(key)` — `ALLOWED_SETTINGS_KEYS` 화이트리스트 기반
- `validatePromptVariants(json)` — JSON 파싱 + 스키마 검증 (`Record<string, { prompt, negative }>`)
- 데이터 변경 핸들러(`UPDATE`, `CREATE`, `SETTINGS_SET`)에 반드시 검증 적용

### 상수 관리

- **Main 프로세스 상수**: `src/main/constants.ts` — 매직 넘버 중앙 관리 (타임아웃, 한도, 크기 등)
- **Renderer 상수**: `src/renderer/src/constants.ts` — UI 관련 상수
- 새 상수 추가 시 해당 파일에 정의 후 import 사용. 인라인 숫자 리터럴 금지

### 로깅

- **라이브러리**: `electron-log` — `src/main/logger.ts`
- main 프로세스에서 `import log from './logger'` (또는 상대 경로)
- `console.log/error/warn/debug` 사용 금지 → `log.info/error/warn/debug` 사용
- 파일 로테이션: 5MB, 레벨: 파일=info, 콘솔=debug

### Composable 패턴

- `src/renderer/src/composables/` — 뷰 간 공유 로직을 composable로 추출
- `useBatchWizard.ts`: 배치 위자드 공통 함수 (모듈 매트릭스 추가, 슬롯 복원, 변수 오버라이드 복원)
- 새 공유 로직 발견 시 composable로 추출하여 중복 제거

### ComfyUI

- API JSON 형식만 지원 (UI 형식 ✕)
- REST: `ofetch` 사용 (`src/main/services/comfyui/client.ts`)
- WebSocket: `ws` 패키지 (Node.js 네이티브, 브라우저 WebSocket 아님)
- 싱글턴 매니저: `src/main/services/comfyui/manager.ts`

## 빌드 & 검증

```bash
npm run dev              # 개발 모드 (HMR)
npm run build            # 타입체크 + 전체 빌드 (검증 시 사용)
npx electron-vite build  # 빌드만 (타입체크 스킵, 빠른 반복)
npm test                 # Vitest 테스트 실행
npm run test:watch       # 감시 모드 테스트
npm run test:coverage    # 커버리지 리포트
npm run lint             # ESLint
npm run format           # Prettier
```

**테스트 프레임워크: Vitest** — 29개 파일, 397개 테스트 케이스.

- 테스트 위치: `tests/main/services/` + `tests/main/ipc/` (소스 구조와 미러링)
- DB 테스트: sql.js in-memory 인스턴스 + `vi.mock()` 으로 `getDatabase`/`saveDatabase` 모킹
- HTTP 테스트: `vi.mock('ofetch')` 으로 REST 클라이언트 모킹
- IPC 검증 테스트: `tests/main/ipc/validators.test.ts` — 32개 테스트 케이스

### 코드 품질 도구

- **Pre-commit 훅**: `husky` + `lint-staged` — 커밋 시 자동 ESLint(`*.ts,*.vue`) + Prettier(`*.ts,*.vue,*.json,*.md`) 실행
- **실행**: `npx husky init` 후 `.husky/pre-commit` 파일이 `npx lint-staged` 실행
- **줄바꿈 정책**: `.gitattributes`로 추적 텍스트 파일 LF 정규화. 대규모 CRLF churn은 기능 변경과 분리
- **릴리즈 무결성**: GitHub Release workflow는 Windows 배포물과 함께 `checksums-sha256.txt`를 생성·첨부해 검증 가능한 초안을 남김

## 현재 구조

### 페이지 구성 (5+1)

v0.7.0에서 4+1 → 5+1 (터미널 추가):

| 페이지     | 뷰             | 설명                                                                                                                      |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 워크플로우 | `WorkflowView` | 워크플로우 가져오기·관리, 역할 설정 (변수 값 편집 제거됨)                                                                 |
| 모듈       | `ModuleView`   | 프롬프트 모듈 카드 그리드, 필 스타일 필터, 아이템별 프롬프트 변형 편집                                                    |
| 작업       | `JobsView`     | 배치 생성(3단계 위자드) + 큐 관리 통합, 슬롯별 변형 선택, 실행 상태 바 + 작업 카드 그리드                                 |
| 갤러리     | `GalleryView`  | 생성 이미지 그리드, 상세 뷰어 (좌우 분할 Lightroom 스타일, 좌우 네비게이션, 클립보드 복사, 프롬프트 표시), 콤팩트 필터 바 |
| 터미널     | `TerminalView` | 내장 터미널 (xterm.js + node-pty), 멀티 탭, MCP 서버 상태                                                                 |
| 설정       | `SettingsView` | 서버 연결, 출력 경로, 테마, 언어, MCP 서버 설정                                                                           |

> **제거된 뷰**: `DashboardView` (연결 상태는 헤더 바로 이동), `BatchView`·`QueueView` (JobsView로 통합)

### MCP 서버 (v0.7.0~)

- `src/main/services/mcp/` — MCP 서버 서비스
  - `index.ts`: 서버 매니저 (Streamable HTTP, 포트 설정, 시작/중지)
  - `tools.ts`: 30개 도구 + 1개 프롬프트 정의 (모듈 CRUD/복제/통계, 아이템 CRUD + 일괄 생성/업데이트/파일 가져오기/내보내기/비교/동기화, 워크플로우, 배치, 태그 검증/검색/인기/치환)
  - `file-parser.ts`: 파일 파서 (JSON/CSV/Markdown → 모듈 아이템 변환)
  - `../tags/utils.ts`: 태그 유틸리티 (replaceTagInPrompt, extractTagsFromPrompt)
  - `config-generator.ts`: 멀티 CLI 설정 자동 생성 (`~/.copilot/mcp-config.json`, `.mcp.json`, Gemini, Codex)
- 기존 Repository 클래스를 직접 호출하므로 IPC를 거치지 않음
- `@modelcontextprotocol/sdk` 패키지 사용
- 보안: localhost만 바인딩 (기본 포트: 39464)
- **세션 관리**: 최대 10개 동시 세션, 30분 타임아웃 자동 정리, LRU 퇴출
- **프롬프트 변형 지원**: `create_module_item`/`update_module_item`에서 `prompt_variants`, `create_batch_job`에서 `slot_mappings` + `promptVariant` 파라미터 지원

### Danbooru 태그 서비스 (v0.10.0~)

- `src/main/services/tags/` — 태그 검증/검색 서비스
  - `index.ts`: TagService 싱글턴 — `resources/Danbooru Tag.txt` 로드, Map 기반 O(1) 조회, 검색, 유사 추천
  - `danbooru-api.ts`: Danbooru REST API 클라이언트 (ofetch, 인메모리 캐시, 5초 타임아웃)
- **로컬 우선 + 온라인 폴백**: 6,549개 태그 로컬 DB → 없으면 Danbooru API 검증
- **유사 태그 추천**: Levenshtein 편집 거리 + 인기도 가중치로 유사 태그 상위 5개 추천
- **시맨틱 그룹**: hair_color, eye_color, expression, clothing, pose 등 10개 그룹으로 태그 분류
- MCP 도구 3개: `validate_danbooru_tags`, `search_danbooru_tags`, `get_popular_danbooru_tags`
- MCP 프롬프트 1개: `danbooru_tag_guide` — 태그 규칙 + 인기 태그 예시

### 터미널 서비스 (v0.7.0~)

- `src/main/services/terminal/pty-manager.ts` — PTY 인스턴스 관리
  - node-pty로 셸 프로세스 spawn (Windows: PowerShell, Mac/Linux: bash/zsh)
  - 멀티 터미널 인스턴스 지원
  - IPC로 renderer와 데이터 송수신
- `src/renderer/src/components/terminal/` — 터미널 UI 컴포넌트
  - `TerminalInstance.vue`: xterm.js 래퍼
  - `TerminalPanel.vue`: 하단 패널 (드래그 리사이즈)
- **MCP 명시적 시작**: 터미널 탭 생성은 MCP 서버 상태나 `mcp_enabled` 설정을 바꾸지 않음. Settings에서 명시적으로 켠 경우에만 즉시 시작 + 다음 앱 실행 시 auto-start

### 배치 실행 최적화 (v0.8.1~)

- **청크 기반 처리**: `listByJobPending(jobId, limit)` — 50개씩 미완료 태스크만 로드
- **ComfyUI 히스토리 자동 정리**: 태스크 완료 후 `deleteFromHistory([promptId])` 호출
- **DB 트랜잭션**: `createBulk()`가 `BEGIN`/`COMMIT`으로 감쌈
- **ETA 계산**: 최근 50개 이동 평균 (`MAX_DURATION_SAMPLES`) × 남은 수. `pushDuration()` 헬퍼가 배열 크기 제한
- **배치 모드 DB 저장**: `setBatchMode(true/false)`로 디바운스 1초→10초 전환. 배치 시작/종료 시 자동 토글
- **prompt_data 정리 빈도**: `CLEAR_PROMPT_DATA_CHUNK_INTERVAL` (5청크=250태스크) 단위로 실행

### 지연 태스크 생성 (v0.9.0~)

- **Lazy Task Expansion**: 배치 생성 시 태스크 행을 사전 생성하지 않고, `module_data_snapshot`과 resolved config만 저장
- **동적 생성**: `processJob()` 실행 시 `expandBatchToTasksChunk(config, moduleData, startIndex, 50)`로 50개씩 생성
- **인덱스 매핑**: `task[i]` → `comboIdx = floor(i / countPerCombination)`, `imgIdx = i % countPerCombination`
- **결정론적 시드**: incremental seed = `fixedSeed + sortOrder`, fixed seed = `fixedSeed` (인덱스 무관)
- **하위 호환**: `module_data_snapshot`이 없는 레거시 작업은 기존 청크 DB 로드 경로 사용
- **DB 공간 절약**: `clearPromptDataForCompleted()` — 완료 태스크의 `prompt_data`를 `{}`로 비움

### 완료 감지 최적화 (v0.9.1~)

- **WebSocket 기반 완료 감지**: `waitForCompletion()`이 `executionComplete`/`executionError` WebSocket 이벤트로 완료 대기
- **REST 폴링 폴백**: WebSocket 연결 끊김 시 자동 전환, 5초 간격 폴링
- **리스너 정리**: Promise settle 시 `removeListener()`로 이벤트 리스너 즉시 정리
- **프리뷰 쓰로틀**: `PREVIEW_THROTTLE_MS = 500` — 초당 2회로 프리뷰 전송 제한

### 작업 복구 (v0.10.3~)

- **앱 시작 시 자동 복구**: `QueueManager.recoverInterruptedJobs()` — 고아 `running` 작업을 `paused`로 전환, stuck `running` 태스크를 `pending`으로 리셋
- **정상 종료 시 상태 보존**: `before-quit`에서 실행 중 작업을 `paused`로 저장
- **Cold Resume**: `resume()`가 인메모리 상태 없이도 DB에서 paused 작업을 찾아 처리 재개
- **Cold Cancel**: `cancel()`이 인메모리 상태 없이도 DB에서 stale 작업을 찾아 취소
- **BatchTaskRepository 메서드**: `resetRunningTasksByJob()`, `cancelRemainingTasksByJob()`

### 전역 스타일 가이드 (v0.6.0~)

- border-radius: 12px (통일)
- 부드러운 트랜지션 및 호버 효과
- 소프트 스크롤바 스타일

## 코드 품질 원칙

v0.12.0 보안 감사에서 도출한 필수 규칙. 상세 패턴과 예시 코드는 `SKILL.md` 참조.

### 보안

- Electron 렌더러: `sandbox: true`, `webSecurity: true`, `bypassCSP: false` — 절대 변경 금지
- Preload 번들링: `externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })` — sandbox 모드에서 preload가 정상 로드되려면 `@electron-toolkit/preload`를 반드시 인라인 번들링
- 파일 경로 접근: `src/main/services/assets/local-asset.ts` helper로 `output_directory` 내부 실경로와 DB에 등록된 gallery 자산 경로만 허용. URL 인코딩 traversal, 절대 경로 우회, realpath escape 차단
- 직접 파일 경로를 받는 권한 높은 IPC(`workflow import`, gallery clipboard/explorer 등)는 별도 allow-list를 만들지 말고 `local-asset` 계열 helper를 재사용
- IPC 핸들러: 데이터 변경(`CREATE`, `UPDATE`, `DELETE`, `SET`) 핸들러에 `validators.ts` 검증 필수
- Repository `update()`: `ALLOWED_UPDATE_FIELDS` 화이트리스트 외 필드 거부. 새 컬럼 추가 시 화이트리스트도 갱신
- JSON 파싱: main은 `src/main/utils/safe-json.ts`, renderer는 `src/renderer/src/utils/safe-json.ts`를 사용해 구조 검증과 오류 메시지를 함께 처리. 검증 없는 `JSON.parse()` 직접 사용 금지

### 에러 처리

- `catch {}` 빈 블록 금지. 반드시 `log.warn`/`log.debug`로 기록하거나, 의도적 무시인 경우 사유 주석 필수
- main 프로세스: `console.*` 사용 금지 → `import log from './logger'` 사용
- 사용자에게 잘못된 상태를 보여줄 수 있는 에러는 무시하지 말고 전파
- renderer store도 실패를 조용히 삼키지 말고 observable error state(`lastError`, `loadError` 등)로 노출

### 코드 중복 방지

- 2개 이상 뷰에서 공유하는 로직 → `src/renderer/src/composables/`로 추출
- 2개 이상 서비스에서 공유하는 함수 → `src/main/ipc/validators.ts` 또는 별도 유틸로 추출
- 숫자 리터럴 인라인 사용 금지 → `src/main/constants.ts` 또는 `src/renderer/src/constants.ts`에 명명 상수 정의
- 여러 뷰에서 재사용하는 locale-reactive option/label map은 `src/renderer/src/utils/view-labels.ts` 같은 순수 helper로 추출해 테스트 가능하게 유지

### i18n

- Vue 템플릿의 사용자 표시 문자열: `t('key')` 필수. 한국어 하드코딩 금지
- 예외: `SettingsView.vue`의 언어 이름 (`'한국어'`, `'English'`)은 하드코딩 허용
- 새 키 추가 시 `ko.json`과 `en.json` 모두 동시 업데이트

### 테스트

- 새 유틸리티/검증 함수 → 반드시 단위 테스트 작성 (`tests/` 디렉토리, 소스 구조 미러링)
- 변경 후 검증: `npm test && npx electron-vite build` 통과 필수
- 커버리지 제외 항목 추가 시 `vitest.config.ts`에 사유 주석 필수

## 현재 버전

**0.15.7** — main 프로세스 crash handler 추가, touched catch 블록의 의도/진단 로그 정리, release workflow SHA256 checksum 첨부, Vitest coverage include 확장. 테스트 397개
**0.15.6** — Gallery 정렬/평점 필터와 Settings 테마 옵션을 locale-reactive helper + computed로 정렬해 실행 중 언어 변경 시 즉시 반영. README 테스트 통계도 28개 파일 / 394개 케이스로 동기화.
**0.15.5** — 숫자 설정 fallback helper, workflow/job destructive action 확인 UX, generation-only workflow 안내, startup/manual connection 실패 토스트, reorder 트랜잭션, terminal instance limit. 테스트 392개
**0.15.4** — 감사 반영 하드닝: 권한 높은 파일 경로 IPC를 `local-asset` 허용 규칙으로 정렬, output root/terminal cwd의 크로스플랫폼 fallback 수정, renderer store 및 MCP/WebSocket JSON 실패 가시성 강화, `.gitattributes` LF 정책 추가. 테스트 374개
**0.15.3** — 갤러리 이미지 회귀 수정: `queue-manager`와 `local-asset` 프로토콜이 같은 출력 루트 해석 규칙을 사용하고, `local-asset`은 현재 출력 디렉터리 + DB 등록 gallery 자산 경로만 허용하도록 조정. 테스트 357개
**0.15.2** — 감사 후속 하드닝: `local-asset` 출력 디렉터리 화이트리스트, 갤러리 쿼리 검증/ORDER BY 화이트리스트, MCP loopback origin 제한 + Settings opt-in 시작, safe-json helper 도입, shipped navigation 정리. 테스트 344개
**0.15.1** — 갤러리 파일명 검색: 필터 바에 검색 입력창 추가, 300ms 디바운스, file_path LIKE 매칭. 테스트 305개
**0.15.0** — MCP 내보내기/비교/동기화 도구: export_module_items_to_file(JSON/CSV/MD 파일 내보내기), diff_module_with_file(이름 기반 매칭+태그 단위 diff), sync_module_from_file(upsert 동기화, delete_missing, dry_run). 파일 직렬화 유틸리티, 비교 엔진. list_modules에 item_count 포함. 테스트 302개
**0.14.0** — MCP 대량 생성/가져오기/복제/통계: bulk_create_module_items(최대 200개 트랜잭션 생성), import_module_items_from_file(JSON/CSV/MD 파일 파싱→등록, dry_run), duplicate_module(모듈+아이템 원자적 복제), get_module_stats(모듈 요약 통계). 파일 파서 유틸리티. 테스트 281개
**0.13.0** — MCP 일괄 작업 도구: bulk_update_module_items(최대 200개 트랜잭션 업데이트), replace_tag_in_module(태그 일괄 치환, dry_run), validate_module_tags(모듈 단위 태그 검증), search_module_items(텍스트 검색), get_module_item(단일 조회), list_module_items 페이지네이션. 태그 유틸리티(replaceTagInPrompt, extractTagsFromPrompt). 테스트 257개
**0.12.7** — 터미널 탭 전환 시 입력 깨짐 수정: display:none→visibility:hidden으로 xterm.js 캔버스 크기 유지, 초기 마운트 시 PTY resize IPC 전송, nextTick+rAF 조합으로 fit() 타이밍 안정화, ResizeObserver 비활성 탭 감지. 테스트 233개
**0.12.6** — 패키징된 앱에서 Danbooru 태그 DB 로드 실패 수정: process.resourcesPath → app.getAppPath() 경로 해석 변경, MCP 태그 도구 자동 재로드, 에러 메시지 상세화. 오프라인 환경 대응: 네트워크 사전 프로브(2초+60초 캐시), unverified 상태 추가, MCP 응답에 online_available 플래그. 테스트 233개
**0.12.5** — 대량 배치 성능 최적화: taskDurations O(n²)→O(1) 이동 평균, 배치 모드 DB 디바운스 10초, 이미지 버퍼 이중 복사 제거, JobsView 폴링 10초+디바운스, GalleryView 새로고침 10초, App.vue IPC 리스너 정리. 테스트 229개
**0.12.4** — Copilot CLI MCP 지원(`~/.copilot/mcp-config.json` 자동 생성), CLI별 개별 상태 표시, 사이드바 접기 시 다이아몬드 아이콘, 터미널 MCP 자동 시작, GitHub Actions Node.js 24 마이그레이션(upload-artifact@v6, download-artifact@v8). 테스트 229개
**0.12.3** — 모듈 아이템 폼 수정: i18n 충돌로 인한 긍정 프롬프트 필드 미표시 해결, 비-네거티브 모듈 및 변형에서 negative 필드 완전 제거 (UI + 합성 엔진), 갤러리 상세 뷰어 사이드바 좌→우 이동. 테스트 229개
**0.12.2** — CI 경고 전면 해소: GitHub Actions Node.js 24 마이그레이션(checkout@v6, setup-node@v5), Vue 속성 순서 경고 10건 수정, ESLint 에러 해결, Prettier 포맷팅 일괄 적용. 테스트 229개
**0.12.1** — v0.12.0 호환성 수정: preload 샌드박스 번들링 수정, 갤러리 이미지 403/CSP 수정, 갤러리 상세 뷰어 좌우 분할 레이아웃 (Lightroom 스타일). 테스트 229개
**0.12.0** — 보안 감사 기반 전면 개선: Electron 보안 하드닝(sandbox/webSecurity/CSP), IPC 입력 검증, Repository 필드 화이트리스트, 경로 순회 차단, 매직 넘버 상수 추출, 배치 위자드 composable, 에러 핸들링 개선, i18n 완성(6개 뷰), 구조화 로깅(electron-log), pre-commit 훅(husky+lint-staged), IPC 검증 테스트 32개. 테스트 229개
**0.11.0** — 갤러리 뷰어 강화: 좌우 네비게이션(← →), 클립보드 복사(Ctrl+C), 파일 탐색기 열기, 상세 모달에서 삭제, 프롬프트/시드 표시, 파일 크기·해상도 표시. 테스트 197개
**0.10.7** — 파일 덮어쓰기 방지: 재실행 시 동일 파일명이면 자동 숫자 접미사(\_001~\_999) 추가. 테스트 197개
**0.10.6** — 재실행 UI 수정: BATCH_RERUN 비블로킹화로 재실행 후 갤러리·작업 상태 즉시 반영. 테스트 197개
**0.10.5** — 실시간 UI 업데이트: BATCH_START 비블로킹화로 작업 시작 즉시 상태 반영, 갤러리 태스크 완료 시 자동 갱신(2초 디바운스). 테스트 197개
**0.10.4** — 변수 오버라이드 UI 일관성: 새 배치 생성 시에도 오버라이드 표시, 접기/펼치기 토글 추가. 테스트 197개
**0.10.3** — 앱 비정상 종료 후 배치 작업 상태 복구: 시작 시 고아 작업 자동 감지→paused 전환, cold resume/cancel 지원, 정상 종료 시 상태 보존. 테스트 197개
**0.10.2** — 고정 모듈 프롬프트 변형 지원: 슬롯에 지정된 `promptVariant`가 고정 모듈 아이템에도 적용 (변형 있으면 사용, 없으면 기본 폴백). 테스트 187개
**0.10.1** — 배치 수정/복제 시 '추가 텍스트' 고정 모듈 혼입 버그 수정: `userPrefixText` 필드로 원본 보존, 복원 시 우선 사용. 테스트 187개
**0.10.0** — Danbooru 태그 검증 MCP 도구: 태그 검증(validate), 검색(search), 인기 태그(get_popular) + 프롬프트 가이드. 로컬 6,549개 태그 + Danbooru API 온라인 폴백. 테스트 187개
**0.9.1** — WebSocket 기반 완료 감지: REST 폴링 제거로 ComfyUI 부하 대폭 절감. 프리뷰 쓰로틀링(500ms). 프롬프트 변형 편집 버그 수정
**0.9.0** — 지연 태스크 생성(Lazy Task Expansion): 배치 생성 시 태스크 사전 생성 없이 실행 시 동적 생성. 모듈 데이터 스냅샷으로 실행 안정성 확보. 테스트 159개
**0.8.1** — 대량 배치 최적화: 청크 기반 태스크 처리(50개 단위), ComfyUI 히스토리 자동 정리, DB 트랜잭션 최적화, 실시간 ETA 표시
**0.8.0** — 슬롯별 프롬프트 변형 (Prompt Variants): 같은 아이템에 대해 슬롯마다 다른 프롬프트 사용 가능. MCP 도구에도 변형 지원 추가. MCP 세션 메모리 누수 수정 (타임아웃 + 최대 세션 제한)
**0.7.1** — MCP 서버 세션 관리 버그 수정, 멀티 CLI 호환성 개선 (Copilot/Claude/Gemini/Codex)
**0.7.0** — MCP 서버 + 내장 터미널: LLM CLI가 앱 기능을 MCP 도구로 제어 가능, 5+1 페이지 구조, 커스텀 앱 아이콘·브랜딩
**0.6.0** — UI 리디자인: 4+1 페이지 구조, 배치/큐 통합 (JobsView), 3단계 배치 위자드
**0.5.0** — 슬롯별 모듈 매핑 (프리픽스/서픽스 + 모듈 체크박스 + 슬롯별 합성)
**0.4.0** — ComfyUI 리소스 브라우저 (모델/LoRA/샘플러 드롭다운) + 배치 작업 복제
**0.3.0** — 프롬프트 슬롯 시스템 (역할 자동 감지 + 수동 설정 + 슬롯 기반 주입)
**0.2.5** — 이미지 다운로드 파라미터 순서 수정, 히스토리 완료 판정 개선
**0.2.4** — 배치 작업 생성 IPC structuredClone 오류 수정
**0.2.3** — 모듈 편집 기능 추가, 배치 빌더 UUID 표시 및 UX 개선
**0.2.2** — IPC structuredClone 직렬화 오류 수정 (toPlain 유틸리티)
**0.2.1** — UI 버그 수정 3건 (모듈 생성, 워크플로우 변수 스크롤, 워크플로우 편집)
**0.2.0** — 테스트 인프라 추가 (Vitest, 146개 테스트 케이스)
