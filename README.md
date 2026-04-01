# ComfyUI Asset Manager

ComfyUI 서버에 연결하여 대량의 이미지를 모듈화된 프롬프트로 생성·관리하는 데스크탑 애플리케이션입니다.

![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron)
![Vue 3](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 주요 기능

### 🔗 ComfyUI 연결

- 로컬 ComfyUI Portable 서버에 REST + WebSocket으로 연결
- 상단 헤더 바에 실시간 연결 상태 표시 및 자동 재연결
- 시작 시 자동 연결 또는 헤더 수동 연결 실패를 토스트로 즉시 표시

### 📋 워크플로우 관리

- ComfyUI **API 형식** JSON 워크플로우 가져오기
- 자동 변수 감지 (시드, 프롬프트, 모델, LoRA 등)
- 프롬프트 슬롯 자동 감지 (긍정/부정 역할 판별)
- 변수 역할 수동 편집
- 삭제는 확인 후 실행되어 실수 클릭 방지

### 🧩 프롬프트 모듈 시스템

- 9가지 모듈 타입: 캐릭터, 복장, 감정, 스타일, 아티스트, 품질, 네거티브, LoRA, 커스텀
- 모듈별 아이템 관리 (프롬프트, 가중치), 드래그 앤 드롭 정렬
- **프롬프트 변형**: 같은 아이템에 슬롯별 다른 텍스트 등록 가능
- 와일드카드 (`{red|blue|green}`) 및 변수 보간 (`{{name}}`)

### 🔄 배치 작업

- **매트릭스 빌더**: 모듈 조합의 카르테시안 곱으로 대량 이미지 생성
- **프롬프트 슬롯 매핑**: 멀티 모델 워크플로우에서 슬롯별 모듈 할당
- 일시정지 / 재개 / 취소, 작업 수정 / 재실행 / 복제
- 취소 / 삭제 같은 파괴적 동작은 확인 후 실행
- 배치 위자드가 생성 카테고리 워크플로우만 노출하며, 숨겨진 비생성 워크플로우 수를 안내
- 실시간 진행률 + ETA, 앱 종료 시 자동 복구

### 🖼️ 갤러리

- 이미지 그리드 뷰, ⭐ 평점, ♥ 즐겨찾기, 다중 선택 & 일괄 삭제
- **상세 뷰어** (좌우 분할): 좌우 네비게이션, 메타데이터, 프롬프트 정보, 클립보드 복사
- **출력 경로 변경 호환**: 현재 출력 디렉터리를 바꿔도 DB에 등록된 기존 갤러리 이미지는 계속 표시

### 🤖 MCP 서버 + 내장 터미널

- **MCP 서버**: LLM CLI (Copilot, Claude, Gemini, Codex)가 앱 기능을 도구로 호출 가능 (30개 도구)
- **대량 작업 도구**: 일괄 생성/업데이트, 파일 가져오기/내보내기 (JSON/CSV/MD), 모듈 비교/동기화, 복제, 태그 치환
- **명시적 MCP 시작**: 설정에서 서버를 켜면 즉시 시작되고 이후 앱 시작 시 자동 실행을 유지. 터미널 탭만으로는 자동 시작되지 않음
- **로컬 전용 HTTP 표면**: `/mcp`는 loopback origin(`localhost`, `127.0.0.1`)만 허용하고 `/health`는 유지
- **내장 터미널**: xterm.js 기반, 멀티 탭, 전용 페이지 + 하단 패널 모드

### ⚙️ 설정

- ComfyUI 서버 주소·포트, 출력 디렉토리/패턴
- 다크/라이트 테마, 한국어/영어 UI, MCP 서버 포트
- 실행 중 언어를 바꾸면 갤러리 정렬/평점 필터와 설정 테마 옵션 라벨도 즉시 갱신

---

## 시작하기

### 필수 조건

- [Node.js](https://nodejs.org/) 22 LTS 권장 (CI 기준)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) Portable 서버 실행 중 (기본: `localhost:8188`)

### 설치 & 실행

```bash
git clone https://github.com/woduseh/comfyui-asset-manager.git
cd comfyui-asset-manager
npm install
npm run dev        # 개발 모드 (HMR)
```

---

## 핵심 개념

이 프로그램을 효과적으로 사용하려면 세 가지 핵심 개념을 이해해야 합니다.

### 모듈과 아이템 — 조합의 차원

**모듈**은 프롬프트의 한 **차원(축)**이고, 모듈 안의 **아이템**은 그 축의 **값들**입니다.

| 모듈 (차원) | 아이템 (값)                        |
| ----------- | ---------------------------------- |
| 캐릭터 모듈 | 앨리스, 밥, 찰리 (3개)             |
| 감정 모듈   | happy, sad, angry, surprised (4개) |
| 복장 모듈   | 교복, 드레스 (2개)                 |

배치 작업에서 이 모듈들을 선택하면 **카르테시안 곱(모든 조합)**이 자동 생성됩니다:

```
3 캐릭터 × 4 감정 × 2 복장 = 24가지 조합
× 조합당 100장 = 총 2,400장 자동 생성
```

### 고정 모듈 vs 조합 모듈

| 구분 | 고정 모듈                                        | 조합 모듈                               |
| ---- | ------------------------------------------------ | --------------------------------------- |
| 역할 | 모든 조합에 **동일하게** 들어감 (변형 적용 가능) | 아이템별로 **달라지며** 매트릭스를 구성 |
| 용도 | 품질 태그, 작가 태그, 스타일 등                  | 캐릭터, 감정, 복장 등                   |
| 예시 | `masterpiece, best quality`                      | 앨리스 / 밥 / 찰리                      |

**최종 프롬프트 구성 순서:**

```
[고정 모듈 프롬프트] + [추가 텍스트] + [조합 모듈 아이템 프롬프트] + [서픽스]
```

### 프롬프트 슬롯 — 어디에 넣을지 결정

복잡한 워크플로우(예: Anima → ILXL 2단계)는 CLIPTextEncode 노드가 4개 이상일 수 있습니다. **프롬프트 슬롯**은 "어떤 노드에 어떤 모듈의 프롬프트를 넣을지" 설정하는 시스템입니다.

```
┌─ Anima 긍정 슬롯 ─────────────────────────────┐
│ 고정 모듈: [작가태그], [품질태그]   ← 항상 동일  │
│ 추가 텍스트: "1girl, ..."                       │
│ 조합 모듈: ☑ 캐릭터  ☑ 감정  ☑ 복장             │
└────────────────────────────────────────────────┘

┌─ ILXL 긍정 슬롯 ──────────────────────────────┐
│ 고정 모듈: [ILXL 작가태그]                      │
│ 조합 모듈: ☑ 캐릭터  □ 감정  ☑ 복장  ← 다르게!  │
└────────────────────────────────────────────────┘
```

슬롯마다 다른 모듈을 할당할 수 있어, 한 워크플로우 안의 여러 모델에 각각 다른 프롬프트를 넣을 수 있습니다.

---

## 사용법

### 1. ComfyUI 연결

1. ComfyUI Portable 서버를 실행합니다
2. 앱 실행 시 자동 연결 (기본: `localhost:8188`)
3. 연결 실패 시 헤더 토스트를 확인하고 **설정** 페이지에서 호스트·포트를 변경합니다

### 2. 워크플로우 등록

1. **워크플로우** 페이지 → **워크플로우 가져오기**
2. ComfyUI에서 **Save (API Format)** 으로 저장한 JSON 파일 선택
3. 자동으로 변수 감지 + 프롬프트 슬롯 판별
4. 필요시 변수의 역할을 수동 변경

> ⚠️ **API 형식** JSON만 지원합니다. ComfyUI에서 `Save (API Format)` 버튼으로 저장하세요.

### 3. 프롬프트 모듈 만들기

1. **모듈** 페이지 → **새 모듈** → 이름, 타입 설정
2. **아이템 추가**로 프롬프트와 가중치 설정

```
📁 캐릭터 모듈 "메인 캐릭터"
   ├── "앨리스"  →  "alice, blue eyes, long blonde hair"
   ├── "밥"      →  "bob, brown eyes, short black hair"
   └── "찰리"    →  "charlie, green eyes, red twintails"

📁 품질 모듈 "아니마 품질태그"  (← 고정 모듈로 사용)
   └── "기본"    →  "masterpiece, best quality, absurdres"
```

> 💡 고정 모듈도 아이템이 최소 1개 필요합니다.

### 4. 배치 작업 생성 & 실행

**작업** 페이지 → **새 배치 작업** (3단계 위자드):

1. **기본 설정**: 워크플로우, 조합당 생성 수, 시드 모드. 이 단계에서는 생성 카테고리 워크플로우만 표시됩니다.
2. **모듈 & 프롬프트**: 조합 모듈 매트릭스 (왼쪽) + 슬롯별 모듈 매핑 (오른쪽)
3. **확인**: 총 이미지 수 미리보기 → **생성**

작업 카드의 **시작** 버튼으로 실행 → 상단 상태 바에서 진행률 확인. 취소·삭제는 확인을 거쳐 accidental click을 방지합니다.

### 5. 결과 확인

**갤러리** 페이지에서 생성된 이미지를 필터·평점·즐겨찾기로 관리합니다.

---

## 개발

### 기술 스택

| 영역          | 기술                                        |
| ------------- | ------------------------------------------- |
| 프레임워크    | Electron 39 + electron-vite                 |
| 프론트엔드    | Vue 3, Pinia, Vue Router, Vue I18n          |
| UI 라이브러리 | Naive UI                                    |
| 터미널        | xterm.js, node-pty                          |
| MCP 서버      | @modelcontextprotocol/sdk (Streamable HTTP) |
| 언어          | TypeScript 5.9                              |
| 데이터베이스  | sql.js (in-memory SQLite, WASM)             |
| HTTP / WS     | ofetch, ws                                  |
| 빌드          | Vite 7, electron-builder                    |
| 테스트        | Vitest                                      |
| 코드 품질     | ESLint, Prettier, husky + lint-staged       |

### 빌드 & 테스트

```bash
npm run build          # 타입 체크 + 빌드
npm run build:win      # Windows 배포 패키지
npm test               # 전체 테스트
npm run test:coverage  # 커버리지 리포트
npm run lint           # ESLint
```

- Git은 `.gitattributes` 기준으로 추적 텍스트 파일을 LF로 정규화합니다. 대규모 줄바꿈 diff가 보이면 먼저 정책 파일과 체크아웃 설정을 확인하세요.
- GitHub Release 초안은 Windows 배포물과 함께 `checksums-sha256.txt`를 첨부해 다운로드 무결성을 확인할 수 있습니다.

### 프로젝트 구조

```
src/
├── main/                          # Electron 메인 프로세스
│   ├── index.ts                   # 앱 진입점
│   ├── ipc/                       # IPC 통신 (channels, handlers, validators)
│   └── services/
│       ├── database/              # sql.js DB + 리포지토리 패턴
│       ├── comfyui/               # REST 클라이언트, WebSocket, 워크플로우 파서
│       ├── prompt/                # 프롬프트 합성 엔진
│       ├── batch/                 # 태스크 생성 + 큐 매니저
│       ├── mcp/                   # MCP 서버 (30개 도구)
│       └── terminal/              # PTY 인스턴스 관리
├── preload/                       # 컨텍스트 브리지
└── renderer/src/                  # Vue 3 SPA
    ├── views/                     # 5+1 페이지
    ├── stores/                    # Pinia 스토어
    ├── composables/               # 공유 로직
    └── locales/                   # i18n (ko, en)
```

### 보안

- Electron 샌드박스 (`sandbox: true`, `webSecurity: true`, `bypassCSP: false`)
- `local-asset://`는 현재 출력 디렉터리 내부 파일과 DB에 등록된 갤러리 이미지 경로만 허용, 경로 순회·realpath escape 차단
- 워크플로우 가져오기와 갤러리 파일 액션(클립보드/탐색기)은 절대 경로 검증 후 같은 허용 규칙을 재사용
- 갤러리 조회 IPC 검증 + SQL `ORDER BY` 화이트리스트로 정렬 입력 하드닝
- MCP HTTP 표면은 loopback origin만 허용하며, Settings opt-in일 때만 자동 시작
- 구조화 로깅 (`electron-log`, 5MB 로테이션)

### 테스트 현황

- 현재 기준 **29개 테스트 파일, 397개 테스트 케이스**

## 라이선스

MIT
