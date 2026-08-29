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

1. `package.json`과 `package-lock.json`의 버전을 함께 변경
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
- main/renderer 공용 타입과 순수 유틸은 `src/shared/`에 정의
- Vue 파일에서 `<script setup lang="ts">` 또는 `<script lang="ts">`

### IPC 패턴

```typescript
// 1. 채널 + args/result 계약 추가 — src/shared/
export const IPC_CHANNELS = {
  MY_FEATURE: 'my-feature:action'
} as const
interface IpcInvokeContract {
  'my-feature:action': IpcCall<MyArgs, MyResult>
}

// 2. 핸들러 등록 — src/main/ipc/handlers.ts
ipcMain.handle(IPC_CHANNELS.MY_FEATURE, async (_event, args) => { ... })

// 3. 렌더러에서 타입 지정 helper 호출
const result = await invokeIpc(IPC_CHANNELS.MY_FEATURE, args)
```

- 도메인 handler가 커지면 `src/main/ipc/handlers/`의 `register*Handlers()` 모듈로 분리하고
  `handlers.ts`는 등록 순서와 소규모 도메인만 소유

### 데이터베이스

- sql.js (WASM SQLite, in-memory)
- 앱은 `requestSingleInstanceLock()`으로 단일 인스턴스만 허용. 여러 프로세스가 같은 DB
  스냅샷을 열고 저장하는 구성을 만들지 않음
- Repository mutation 메서드가 내부에서 `saveDatabase()`를 예약. handler/service에서 중복 호출 금지
- 여러 mutation을 하나로 묶을 때는 `withTransaction()` 사용. 중첩은 SAVEPOINT로 처리하며
  최외곽 커밋 후 저장을 한 번만 예약
- DB 파일 저장은 단일 직렬 writer와 임시 파일+rename을 사용하고, 정상 종료 시
  `closeDatabase()` flush를 반드시 await
- Repository 패턴: `src/main/services/database/repositories/index.ts`
- 새 테이블 추가 시 `createTables()` 함수에 `CREATE TABLE IF NOT EXISTS` 추가
- `module_items.prompt_variants`: JSON 컬럼 — `Record<string, { prompt, negative }>` 형식으로 슬롯별 변형 프롬프트 저장
- **Repository 필드 화이트리스트**: `ALLOWED_UPDATE_FIELDS`로 update() 시 허용 필드만 통과. 새 필드 추가 시 화이트리스트에도 반영 필수

### 컴포넌트 & 스토어

- Naive UI 컴포넌트는 개별 import (tree-shaking)
- Pinia 스토어는 Composition API 패턴 (`defineStore(name, setupFn)`)
- 스토어에서 main process와 통신 시 `invokeIpc()` 사용
- 파괴적 renderer 액션(삭제, 취소 등)은 bare 버튼을 직접 두기보다 `src/renderer/src/components/common/ConfirmActionButton.ts` 같은 재사용 확인 컴포넌트 우선
- 일반 페이지는 `PageShell` + `PageHeader`를 사용해 최대 폭(기본 1440px, 설정형 960px)과 헤더 간격을 통일
- 카드/행의 보조 액션이 2개 이상이면 `OverflowActionMenu`로 이동하고, 파괴적 항목은 `confirmText`를 지정해 재확인
- 상태색(success/warning/error)은 연결·실행 결과에만 사용하고 모듈 유형 같은 카테고리는 기본 중립 태그 사용

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
npm run dist:portable    # Windows 포터블 실행 파일
npm run dist:installer   # Windows NSIS 설치 파일
npm run dist:all         # Windows 포터블 + 설치 파일
npx electron-vite build  # 빌드만 (타입체크 스킵, 빠른 반복)
npm test                 # Vitest 테스트 실행
npm run test:watch       # 감시 모드 테스트
npm run test:coverage    # 커버리지 리포트
npm run lint             # ESLint
npm run format           # Prettier
```

배포 스크립트는 `dist:*` 네임스페이스를 사용합니다. `dist:all`의 `all`은 지원 운영체제
전체가 아니라 Windows의 포터블·NSIS 설치 형식 전체를 의미합니다.

**테스트 프레임워크: Vitest** — 현재 규모와 통과 여부는 `npm test`로 확인.

- 테스트 위치: `tests/main/`, `tests/renderer/`, `tests/shared/` (소스 구조와 미러링)
- DB 테스트: sql.js in-memory 인스턴스 + `vi.mock()` 으로 `getDatabase`/`saveDatabase` 모킹
- HTTP 테스트: `vi.mock('ofetch')` 으로 REST 클라이언트 모킹
- IPC 검증 테스트: `tests/main/ipc/validators.test.ts` + `handlers.test.ts`
- locale 키 정합성: `tests/renderer/locales.test.ts`

### 코드 품질 도구

- **Pre-commit 훅**: `husky` + `lint-staged` — 커밋 시 자동 ESLint(`*.ts,*.vue`) + Prettier(`*.ts,*.vue,*.json,*.md`) 실행
- **실행**: `npx husky init` 후 `.husky/pre-commit` 파일이 `npx lint-staged` 실행
- **줄바꿈 정책**: `.gitattributes`로 추적 텍스트 파일 LF 정규화. 대규모 CRLF churn은 기능 변경과 분리
- **CI 품질 게이트**: lint + typecheck + coverage thresholds + `electron-vite build`를 순서대로 실행
- **릴리즈 무결성**: GitHub Release workflow는 `node-pty` 재빌드가 가능한 Windows 2022
  러너를 사용하고, 배포물과 `checksums-sha256.txt`를 생성·첨부해 검증 가능한 초안을 남김

## 현재 구조

### 페이지 구성 (5+1)

v0.7.0에서 4+1 → 5+1 (터미널 추가):

| 페이지     | 뷰             | 설명                                                                                          |
| ---------- | -------------- | --------------------------------------------------------------------------------------------- |
| 워크플로우 | `WorkflowView` | 워크플로우 가져오기·관리, 역할 설정 (변수 값 편집 제거됨)                                     |
| 모듈       | `ModuleView`   | 프롬프트 모듈 카드 그리드, 유형 필터·검색·정렬, 아이템별 프롬프트 변형 편집                   |
| 작업       | `JobsView`     | 배치 생성(3단계 위자드) + 큐 관리 통합, 연결 중단 상태·재연결, 슬롯별 변형 선택, 실행 상태 바 |
| 갤러리     | `GalleryView`  | 생성 이미지 그리드, 누락 썸네일 페이지 단위 선택, 상세 뷰어, 콤팩트 필터 바                   |
| 터미널     | `TerminalView` | 내장 터미널 (xterm.js + node-pty), 초기화·실패 상태, 멀티 탭, MCP 서버 상태                   |
| 설정       | `SettingsView` | 서버 연결, 출력 경로, 테마, 언어, MCP 서버 설정                                               |

> **제거된 뷰**: `DashboardView` (연결 상태는 헤더 바로 이동), `BatchView`·`QueueView` (JobsView로 통합)

### MCP 서버 (v0.7.0~)

- `src/main/services/mcp/` — MCP 서버 서비스
  - `index.ts`: 서버 매니저 (Streamable HTTP, 포트 설정, 시작/중지)
  - `tools/`: 30개 도구 + 1개 프롬프트를 도메인별 등록 모듈로 정의
  - `file-parser.ts`: 파일 파서 (JSON/CSV/Markdown → 모듈 아이템 변환)
  - `../tags/utils.ts`: 태그 유틸리티 (replaceTagInPrompt, extractTagsFromPrompt)
  - `config-generator.ts`: 사용자가 Settings에서 명시적으로 요청할 때만 `.mcp.json`, Gemini, Copilot CLI 설정 생성/제거
- 기존 Repository 클래스를 직접 호출하므로 IPC를 거치지 않음
- `@modelcontextprotocol/sdk` 패키지 사용
- 보안: localhost만 바인딩 (기본 포트: 39464), `/mcp` Bearer 인증 기본 ON,
  `/health`만 공개
- **세션 관리**: 최대 10개 동시 세션, 30분 타임아웃 자동 정리, LRU 퇴출
- **외부 설정 무부작용**: MCP 서버 start/stop은 CLI 설정 파일을 수정하지 않음. Codex는 공식 `codex mcp add/remove` 명령으로만 등록하며 앱은 `~/.codex/config.toml`을 읽기만 함
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

- **청크 기반 처리**: `listByJobPending(jobId, limit)` — 50개씩 `pending`/`retrying` 태스크만 로드. 성공·최종 실패·취소만 terminal 상태로 취급
- **재시도 설정**: `max_retries`가 정식 설정 키이며 초기 시도 이후의 추가 시도 횟수를 뜻함. `batch.maxRetries`는 읽기 호환만 허용
- **ComfyUI 히스토리 자동 정리**: 태스크 시도 종료 후 성공·실패와 무관하게 `deleteFromHistory([promptId])` 호출
- **DB 트랜잭션**: `createBulk()`가 `BEGIN`/`COMMIT`으로 감쌈
- **ETA 계산**: 최근 50개 이동 평균 (`MAX_DURATION_SAMPLES`) × 남은 수. `pushDuration()` 헬퍼가 배열 크기 제한
- **배치 모드 DB 저장**: `setBatchMode(true/false)`로 디바운스 1초→10초 전환. 배치 시작/종료 시 자동 토글
- **prompt_data 정리 빈도**: `CLEAR_PROMPT_DATA_CHUNK_INTERVAL` (5청크=250태스크) 단위로 실행

### 지연 태스크 생성 (v0.9.0~)

- **Lazy Task Expansion**: 배치 생성 시 태스크 행을 사전 생성하지 않고, `module_data_snapshot`과 resolved config만 저장
- **공용 생성 서비스**: IPC/MCP adapter는 `batch-job-service.ts`를 통해 동일한 검증·prefix 해석·snapshot·task count를 사용. adapter에서 eager task 생성을 다시 구현하지 않음
- **draft 편집**: 기존 ID를 유지하는 `updateDraft()`만 사용하고, 실행 이력이 있는 작업은 clone-only. 삭제 후 재생성 방식 금지
- **동적 생성**: `processJob()` 실행 시 `expandBatchToTasksChunk(config, moduleData, startIndex, 50)`로 50개씩 생성
- **인덱스 매핑**: `task[i]` → `comboIdx = floor(i / countPerCombination)`, `imgIdx = i % countPerCombination`
- **결정론적 시드**: incremental seed = `fixedSeed + sortOrder`, fixed seed = `fixedSeed` (인덱스 무관)
- **하위 호환**: `module_data_snapshot`이 없는 레거시 작업은 기존 청크 DB 로드 경로 사용
- **DB 공간 절약**: `clearPromptDataForCompleted()` — 완료 태스크의 `prompt_data`를 `{}`로 비움
- **출력 containment**: 폴더·파일명은 `output-path.ts` helper로 출력 루트 내부인지 확인. 상위 경로, 절대 경로, 파일명 경로 성분을 허용하지 않으며 중복 suffix 한도 소진 시 덮어쓰지 않고 실패
- **결과 원자성**: 이미지 없는 완료 응답은 실패. 한 태스크의 gallery 행과 완료 상태는 단일 transaction으로 기록하고 실패 시 해당 시도의 출력 파일을 정리
- **QueueManager 책임 분리**: prompt/seed 주입은 `prompt-injection.ts`, 출력 폴더·파일 다운로드·부분 파일 정리는 `task-output.ts`에 유지
- **재실행 순서**: terminal 상태와 ComfyUI 연결을 preflight한 뒤 태스크 삭제·진행률 초기화를 `withTransaction()`으로 묶고, 그 후 background start 요청

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
- 호버 상승 효과는 클릭 가능한 `.interactive-card`에만 적용
- 소프트 스크롤바 스타일
- 제목/설명/메타 텍스트는 공용 `.card-title`/`.card-description`/`.meta-text` 계층 사용
- 갤러리의 DB-only 삭제 액션은 “갤러리에서 제거”로 표현하고 원본 파일이 유지됨을 확인 문구에 명시. 물리 파일 삭제로 의미를 확대하지 않음
- Gallery/Module 뷰의 필터·카드·브라우저처럼 독립적인 UI 영역은 각 도메인의 `components/`로 분리하고, 표시용 순수 변환은 `utils/`에 두어 테스트 가능하게 유지

## 코드 품질 원칙

v0.12.0 보안 감사에서 도출한 필수 규칙. 상세 패턴과 예시 코드는 `SKILL.md` 참조.

### 보안

- Electron 렌더러: `sandbox: true`, `webSecurity: true`, `bypassCSP: false` — 절대 변경 금지
- renderer의 새 창 요청은 `http:`·`https:` 외 URL 스킴을 `shell.openExternal()`에 전달하지 않음
- `local-asset` 프로토콜은 이미지 표시 용도만 유지하고 불필요한 `supportFetchAPI` 권한을 추가하지 않음
- Preload 번들링: `externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })` — sandbox 모드에서 preload가 정상 로드되려면 `@electron-toolkit/preload`를 반드시 인라인 번들링
- 자산 경로 접근: `src/main/services/assets/local-asset.ts` helper로 `output_directory` 내부 실경로와 DB에 등록된 gallery 자산 경로만 허용. URL 인코딩 traversal, 절대 경로 우회, realpath escape 차단
- 외부 파일 가져오기: 파일 선택과 읽기를 같은 main-process IPC에서 완료. renderer에 선택 경로를 반환한 뒤 별도 읽기 IPC로 다시 받는 패턴 금지
- gallery clipboard/explorer처럼 자산 경로를 직접 받는 IPC는 `local-asset` 계열 helper를 재사용
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

**1.0.1** — main 소유 workflow import, IPC 런타임 검증, 핵심 커버리지·릴리스 정합성 게이트 강화.
**1.0.0** — MCP Bearer 인증 기본 적용, 토큰 회전·클라이언트 설정 갱신·Codex 환경변수 등록 흐름 추가.
**0.16.3** — DB 트랜잭션·직렬 원자 저장, MCP 도구 도메인 분할, JobsView 컴포넌트 분리.

이전 버전 내역은 `CHANGELOG.md`를 참조합니다.
