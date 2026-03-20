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

### 컴포넌트 & 스토어

- Naive UI 컴포넌트는 개별 import (tree-shaking)
- Pinia 스토어는 Composition API 패턴 (`defineStore(name, setupFn)`)
- 스토어에서 main process와 통신 시 `window.electron.ipcRenderer.invoke()` 사용

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

**테스트 프레임워크: Vitest** — 5개 파일, 159개 테스트 케이스.
- 테스트 위치: `tests/main/services/` (소스 구조와 미러링)
- DB 테스트: sql.js in-memory 인스턴스 + `vi.mock()` 으로 `getDatabase`/`saveDatabase` 모킹
- HTTP 테스트: `vi.mock('ofetch')` 으로 REST 클라이언트 모킹

## 현재 구조

### 페이지 구성 (5+1)

v0.7.0에서 4+1 → 5+1 (터미널 추가):

| 페이지 | 뷰 | 설명 |
|--------|-----|------|
| 워크플로우 | `WorkflowView` | 워크플로우 가져오기·관리, 역할 설정 (변수 값 편집 제거됨) |
| 모듈 | `ModuleView` | 프롬프트 모듈 카드 그리드, 필 스타일 필터, 아이템별 프롬프트 변형 편집 |
| 작업 | `JobsView` | 배치 생성(3단계 위자드) + 큐 관리 통합, 슬롯별 변형 선택, 실행 상태 바 + 작업 카드 그리드 |
| 갤러리 | `GalleryView` | 생성 이미지 그리드, 콤팩트 필터 바 |
| 터미널 | `TerminalView` | 내장 터미널 (xterm.js + node-pty), 멀티 탭, MCP 서버 상태 |
| 설정 | `SettingsView` | 서버 연결, 출력 경로, 테마, 언어, MCP 서버 설정 |

> **제거된 뷰**: `DashboardView` (연결 상태는 헤더 바로 이동), `BatchView`·`QueueView` (JobsView로 통합)

### MCP 서버 (v0.7.0~)

- `src/main/services/mcp/` — MCP 서버 서비스
  - `index.ts`: 서버 매니저 (Streamable HTTP, 포트 설정, 시작/중지)
  - `tools.ts`: 15개 핵심 도구 정의 (모듈 CRUD, 아이템 CRUD, 워크플로우, 배치)
  - `config-generator.ts`: 멀티 CLI 설정 자동 생성 (`.mcp.json`, Gemini, Codex)
- 기존 Repository 클래스를 직접 호출하므로 IPC를 거치지 않음
- `@modelcontextprotocol/sdk` 패키지 사용
- 보안: localhost만 바인딩 (기본 포트: 39464)
- **세션 관리**: 최대 10개 동시 세션, 30분 타임아웃 자동 정리, LRU 퇴출
- **프롬프트 변형 지원**: `create_module_item`/`update_module_item`에서 `prompt_variants`, `create_batch_job`에서 `slot_mappings` + `promptVariant` 파라미터 지원

### 터미널 서비스 (v0.7.0~)

- `src/main/services/terminal/pty-manager.ts` — PTY 인스턴스 관리
  - node-pty로 셸 프로세스 spawn (Windows: PowerShell, Mac/Linux: bash/zsh)
  - 멀티 터미널 인스턴스 지원
  - IPC로 renderer와 데이터 송수신
- `src/renderer/src/components/terminal/` — 터미널 UI 컴포넌트
  - `TerminalInstance.vue`: xterm.js 래퍼
  - `TerminalPanel.vue`: 하단 패널 (드래그 리사이즈)

### 배치 실행 최적화 (v0.8.1~)

- **청크 기반 처리**: `listByJobPending(jobId, limit)` — 50개씩 미완료 태스크만 로드
- **ComfyUI 히스토리 자동 정리**: 태스크 완료 후 `deleteFromHistory([promptId])` 호출
- **DB 트랜잭션**: `createBulk()`가 `BEGIN`/`COMMIT`으로 감쌈
- **ETA 계산**: 완료된 태스크 평균 소요 시간 × 남은 수 → `queue:task-completed` 이벤트에 `etaMs`, `avgTaskDurationMs` 포함

### 지연 태스크 생성 (v0.9.0~)

- **Lazy Task Expansion**: 배치 생성 시 태스크 행을 사전 생성하지 않고, `module_data_snapshot`과 resolved config만 저장
- **동적 생성**: `processJob()` 실행 시 `expandBatchToTasksChunk(config, moduleData, startIndex, 50)`로 50개씩 생성
- **인덱스 매핑**: `task[i]` → `comboIdx = floor(i / countPerCombination)`, `imgIdx = i % countPerCombination`
- **결정론적 시드**: incremental seed = `fixedSeed + sortOrder`, fixed seed = `fixedSeed` (인덱스 무관)
- **하위 호환**: `module_data_snapshot`이 없는 레거시 작업은 기존 청크 DB 로드 경로 사용
- **DB 공간 절약**: `clearPromptDataForCompleted()` — 완료 태스크의 `prompt_data`를 `{}`로 비움

### 전역 스타일 가이드 (v0.6.0~)

- border-radius: 12px (통일)
- 부드러운 트랜지션 및 호버 효과
- 소프트 스크롤바 스타일

## 현재 버전

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
