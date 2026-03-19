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
npm run lint             # ESLint
npm run format           # Prettier
```

**테스트 프레임워크는 아직 설정되지 않았습니다.** 빌드 성공 여부로 검증합니다.

## 현재 버전

**0.1.0** — 전체 파이프라인 기능 완성 (ComfyUI 연결 → 워크플로우 → 모듈 → 배치 → 큐 → 갤러리 → 대시보드)
