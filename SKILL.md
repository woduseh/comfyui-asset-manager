# SKILL.md — ComfyUI Asset Manager 코딩 가이드

이 문서는 v0.12.0 보안 감사에서 도출한 상세 코딩 패턴과 안티패턴을 정리합니다.
`AGENTS.md`의 "코드 품질 원칙"과 함께 읽어주세요.

---

## 1. Electron 보안 체크리스트

BrowserWindow 생성 또는 프로토콜 핸들러 수정 시 반드시 확인:

```
☑ sandbox: true
☑ webSecurity: true
☑ bypassCSP: false
☑ nodeIntegration: false (기본값 유지)
☑ contextIsolation: true (기본값 유지)
☑ 커스텀 프로토콜 핸들러에서 경로 검증 (path.normalize + 화이트리스트)
☑ 파일 접근 시 허용 디렉토리 외부 요청은 403 반환
```

### 경로 검증 패턴

```typescript
// ✅ 올바른 패턴 — local-asset:// 프로토콜 핸들러
import path from 'path'

const normalizedPath = path.normalize(decodedPath)
const resolvedPath = path.resolve(normalizedPath)
const allowedDir = settingsRepo.get('output_directory')

if (!resolvedPath.startsWith(allowedDir + path.sep) && resolvedPath !== allowedDir) {
  return new Response('Forbidden', { status: 403 })
}
```

```typescript
// ❌ 안티패턴 — 검증 없이 경로 사용
const filePath = decodeURIComponent(url.pathname)
return net.fetch(pathToFileURL(filePath).toString()) // 경로 순회 가능!
```

---

## 2. IPC 핸들러 개발 패턴

새 IPC 핸들러를 추가할 때 따라야 할 단계:

### 2.1 채널 상수 등록

```typescript
// src/main/ipc/channels.ts
export const IPC_MY_FEATURE_CREATE = 'my-feature:create'
export const IPC_MY_FEATURE_UPDATE = 'my-feature:update'
export const IPC_MY_FEATURE_DELETE = 'my-feature:delete'
```

### 2.2 입력 검증 포함한 핸들러 등록

```typescript
// src/main/ipc/handlers.ts
import { validateString, validateId, validatePositiveInt } from './validators'

ipcMain.handle(IPC_MY_FEATURE_CREATE, async (_event, args) => {
  // 1. 입력 검증 (데이터 변경 핸들러에 필수)
  const name = validateString(args.name, 200)
  const count = validatePositiveInt(args.count)

  // 2. 비즈니스 로직
  const result = myRepository.create({ name, count })

  // 3. DB 저장 (mutation 후 필수)
  saveDatabase()

  return result
})
```

```typescript
// ❌ 안티패턴 — 검증 없이 렌더러 입력을 신뢰
ipcMain.handle(IPC_MY_FEATURE_CREATE, async (_event, args) => {
  return myRepository.create(args) // args 내용이 뭐든 그대로 DB에 들어감!
})
```

### 2.3 검증 함수 선택 가이드

| 입력 유형    | 검증 함수                      | 용도                             |
| ------------ | ------------------------------ | -------------------------------- |
| 문자열 일반  | `validateString(val, maxLen?)` | 이름, 설명, 프롬프트 텍스트      |
| ID (UUID 등) | `validateId(val)`              | 엔티티 식별자 (`[a-zA-Z0-9_-]+`) |
| 양의 정수    | `validatePositiveInt(val)`     | 카운트, 페이지 번호, 포트        |
| 평점         | `validateRating(val)`          | 0~5 범위 숫자                    |
| 설정 키      | `validateSettingsKey(key)`     | 화이트리스트 기반 설정 키        |
| 문자열 배열  | `validateStringArray(val)`     | ID 목록 (삭제 등)                |
| JSON 구조    | `validatePromptVariants(raw)`  | 프롬프트 변형 JSON               |

### 2.4 새 검증 함수 추가 시

1. `src/main/ipc/validators.ts`에 함수 추가
2. `tests/main/ipc/validators.test.ts`에 테스트 케이스 추가 (정상값 + 경계값 + 잘못된 입력)
3. `npm test` 통과 확인

---

## 3. Repository 개발 패턴

### 3.1 update() 메서드의 필드 화이트리스트

```typescript
// src/main/services/database/repositories/index.ts

// 테이블별 허용 필드 정의
const ALLOWED_UPDATE_FIELDS: Record<string, Set<string>> = {
  workflows: new Set(['name', 'description', 'json_data', 'category', 'variables_config']),
  prompt_modules: new Set(['name', 'type', 'description'])
  // ...
}

// update() 내부에서 필터링
function sanitizeUpdateFields(table: string, data: Record<string, unknown>) {
  const allowed = ALLOWED_UPDATE_FIELDS[table]
  if (!allowed) return data
  return Object.fromEntries(Object.entries(data).filter(([key]) => allowed.has(key)))
}
```

**새 테이블 컬럼 추가 시**: `createTables()`의 스키마와 `ALLOWED_UPDATE_FIELDS`를 **반드시** 동시에 업데이트.

### 3.2 mutation 후 저장

```typescript
// ✅ 모든 mutation(create, update, delete) 후 호출 필수
repository.create({ ... })
saveDatabase()

// ❌ 안티패턴 — saveDatabase() 누락
repository.update(id, data)  // 인메모리에만 반영, 앱 종료 시 소실!
```

---

## 4. 에러 처리 패턴

### 4.1 로깅 레벨 기준

| 레벨        | 용도                      | 예시                                 |
| ----------- | ------------------------- | ------------------------------------ |
| `log.error` | 복구 불가능한 오류        | DB 로드 실패, 파일 시스템 에러       |
| `log.warn`  | 복구 가능하지만 주의 필요 | 네트워크 타임아웃, 잘못된 입력 거부  |
| `log.info`  | 주요 상태 변경            | 서버 시작/중지, 작업 완료, 설정 변경 |
| `log.debug` | 개발 디버깅용             | 상세 처리 과정, 캐시 히트/미스       |

### 4.2 catch 블록 규칙

```typescript
// ✅ 패턴 1: 에러 기록 후 계속 진행
try {
  await riskyOperation()
} catch (err) {
  log.warn('Operation failed, using fallback:', err)
  return fallbackValue
}

// ✅ 패턴 2: 의도적 무시 — 반드시 사유 주석
try {
  await optionalCleanup()
} catch {
  // Cleanup failure is non-critical; process is shutting down
}

// ❌ 안티패턴 — 빈 catch
try {
  await importantOperation()
} catch {} // 뭐가 실패했는지 알 수 없음!
```

### 4.3 사용자 상태에 영향을 주는 에러

사용자에게 잘못된 상태를 보여줄 수 있는 함수에서는 에러를 무시하면 안 됨:

```typescript
// ❌ loadQueueStatus() 에러 무시 → UI에 이전 상태가 계속 표시
try {
  queueStatus = await fetchStatus()
} catch {}

// ✅ 에러를 전파하거나 UI에 에러 상태 표시
try {
  queueStatus = await fetchStatus()
} catch (err) {
  log.warn('Failed to fetch queue status:', err)
  throw err // 또는 에러 상태를 UI에 반영
}
```

---

## 5. 상수 관리 패턴

### 5.1 어디에 정의하는가

| 상수 유형            | 위치                            | 예시                                   |
| -------------------- | ------------------------------- | -------------------------------------- |
| 타임아웃, 한도, 크기 | `src/main/constants.ts`         | `BATCH_CHUNK_SIZE`, `MCP_MAX_SESSIONS` |
| UI 관련 기본값       | `src/renderer/src/constants.ts` | `DEFAULT_GALLERY_PAGE_SIZE`            |
| 특정 서비스 내부용   | 해당 파일 상단                  | `const CACHE_TTL = 300_000`            |

### 5.2 명명 규칙

```typescript
// ✅ 단위 접미사 포함
const WS_RECONNECT_INTERVAL_MS = 3000
const LOG_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MCP_SESSION_TIMEOUT_MS = 30 * 60 * 1000

// ❌ 단위 불명확
const RECONNECT_INTERVAL = 3000 // ms? seconds?
const MAX_FILE_SIZE = 5242880 // bytes? KB?
```

---

## 6. Vue 컴포넌트 패턴

### 6.1 i18n 규칙

```vue
<!-- ✅ i18n 키 사용 -->
<n-button>{{ t('module.create') }}</n-button>
<n-empty :description="t('gallery.empty')" />

<!-- ❌ 하드코딩 한국어 -->
<n-button>모듈 생성</n-button>
<n-empty description="이미지가 없습니다" />
```

**중괄호 이스케이프**: vue-i18n에서 리터럴 `{`, `}`를 표시할 때:

```json
// ko.json
{ "batch.wizard.availableVars": "사용 가능한 변수: {lbrace}character{rbrace}" }
```

```vue
{{ t('batch.wizard.availableVars', { lbrace: '{', rbrace: '}' }) }}
```

### 6.2 Composable 추출 기준

2개 이상의 뷰에서 동일한 로직이 나타나면 composable로 추출:

```typescript
// src/renderer/src/composables/useBatchWizard.ts
// 함수를 export하고, 호출 측에서 필요한 ref를 매개변수로 전달
export function addModuleToMatrix(
  modules: Ref<Module[]>,
  selectedModules: Ref<MatrixModule[]>,
  moduleId: string
) {
  // 공통 로직
}
```

컴포넌트에서 호출하는 쪽의 차이점은 옵션 객체로 처리:

```typescript
restoreSlotMappings(slotMappings, { useUserPrefixText: true }) // JobsView
restoreSlotMappings(slotMappings, { useUserPrefixText: false }) // BatchView
```

---

## 7. 테스트 작성 패턴

### 7.1 테스트 파일 위치

소스 구조를 미러링:

```
src/main/ipc/validators.ts        → tests/main/ipc/validators.test.ts
src/main/services/tags/index.ts   → tests/main/services/tags/index.test.ts
src/main/services/batch/queue-manager.ts → tests/main/services/batch/queue-manager.test.ts
```

### 7.2 DB 테스트 모킹

```typescript
import { vi } from 'vitest'

// sql.js 인메모리 DB를 직접 사용
vi.mock('@main/services/database', () => {
  let db: Database
  return {
    getDatabase: () => db,
    saveDatabase: vi.fn(),
    initDatabase: async () => {
      db = new SQL.Database()
    }
  }
})
```

### 7.3 검증 함수 테스트 구조

```typescript
describe('validateString', () => {
  it('returns valid string as-is', () => { ... })
  it('throws on non-string input', () => { ... })
  it('throws when exceeding max length', () => { ... })
  it('allows empty string', () => { ... })
  it('handles edge case: exactly at max length', () => { ... })
})
```

**3가지 반드시 테스트**: 정상 입력, 경계값, 잘못된 입력.

---

## 8. 변경 전 자가 검증 체크리스트

코드 변경을 커밋하기 전에 확인:

```
☑ npm test — 전체 테스트 통과
☑ npx electron-vite build — 빌드 성공
☑ 새 IPC 핸들러 → 입력 검증 적용했는가?
☑ 새 DB 컬럼 → ALLOWED_UPDATE_FIELDS에 추가했는가?
☑ 새 숫자 리터럴 → constants.ts에 명명 상수로 추출했는가?
☑ 새 UI 문자열 → t() 호출 + ko.json/en.json 동시 추가했는가?
☑ 새 catch 블록 → 로깅 또는 사유 주석이 있는가?
☑ 새 유틸 함수 → 단위 테스트를 작성했는가?
☑ console.* 사용 → log.* (electron-log)로 교체했는가?
☑ CHANGELOG.md + AGENTS.md 업데이트했는가?
```
