# ComfyUI Asset Manager

ComfyUI 서버에 연결하여 대량의 이미지를 모듈화된 프롬프트로 생성·관리하는 데스크탑 애플리케이션입니다.

![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron)
![Vue 3](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 주요 기능

### 🔗 ComfyUI 연결
- 로컬 ComfyUI Portable 서버에 REST + WebSocket으로 연결
- 실시간 연결 상태 모니터링 및 자동 재연결
- 시스템 통계 (GPU, VRAM) 조회

### 📋 워크플로우 관리
- ComfyUI API 형식 JSON 워크플로우 가져오기
- 자동 변수 감지 (시드, 프롬프트, 모델, LoRA 등)
- **프롬프트 슬롯 자동 감지**: CLIPTextEncode → KSampler 연결 추적으로 긍정/부정 역할 자동 판별
- 카테고리 자동 분류: 생성 / 업스케일 / 디테일러 / 커스텀
- 변수 역할 수동 편집: 긍정 프롬프트 / 부정 프롬프트 / 시드 / 고정값 / 사용자 정의
- **변수 값 직접 편집**: 모델·LoRA·샘플러·스케줄러를 ComfyUI 서버 목록에서 드롭다운 선택
- LoRA 가중치 슬라이더 (0~2), 시드 랜덤 버튼 🎲

### 🧩 프롬프트 모듈 시스템
- 9가지 모듈 타입: 캐릭터, 복장, 감정, 스타일, 아티스트, 품질, 네거티브, LoRA, 커스텀
- 모듈별 아이템 관리 (프롬프트, 네거티브, 가중치)
- 와일드카드 지원: `{red|blue|green}` → 랜덤 선택
- 변수 보간: `{{character_name}}` → 값 치환
- 실시간 프롬프트 미리보기

### 🔄 배치 작업 시스템
- **매트릭스 빌더**: 모듈 조합의 카르테시안 곱으로 대량 작업 생성
  - 예: 캐릭터 3명 × 복장 5벌 × 감정 20개 × 조합당 100장 = 30,000장
- **프롬프트 슬롯 매핑**: 워크플로우 선택 시 프롬프트 슬롯 표시, 주입/고정 모드 선택
  - 멀티 모델 워크플로우에서 어떤 슬롯에 모듈 프롬프트를 주입할지 명시적 설정
- **변수 오버라이드**: 모델·LoRA·샘플러 등 비프롬프트 변수를 배치별로 개별 오버라이드
- **배치 작업 복제**: 기존 배치 작업의 설정을 그대로 복원하여 재사용
- 시드 모드: 랜덤 / 고정 / 증분
- 출력 폴더·파일명 패턴 설정 (`{character}/{outfit}/{emotion}` 등)
- 작업 생성 전 총 조합 수·이미지 수 미리보기

### ⚡ 큐 관리 & 실행
- 순차 작업 처리 (ComfyUI에 프롬프트 제출 → 결과 대기 → 이미지 저장)
- 일시정지 / 재개 / 취소 지원
- 자동 재시도 (설정 가능한 최대 횟수)
- 실시간 진행률 표시

### 🖼️ 갤러리
- 생성 이미지 그리드 뷰 (반응형 2~5열)
- ⭐ 5점 평점 & ♥ 즐겨찾기
- 필터: 정렬, 평점, 즐겨찾기
- 다중 선택 & 일괄 삭제
- 이미지 상세 모달 (메타데이터 표시)

### 📊 대시보드
- 서버 연결 상태, 실행 중 작업, 진행률 한눈에 보기
- 총 이미지 수, 즐겨찾기 수, 워크플로우·모듈 수 통계
- 최근 생성 이미지 목록
- 주요 기능으로의 빠른 이동

### ⚙️ 설정
- ComfyUI 서버 주소·포트 설정
- 출력 디렉토리 및 폴더/파일명 패턴
- 다크/라이트 테마
- 한국어/영어 UI

## 시작하기

### 필수 조건

- [Node.js](https://nodejs.org/) 18 이상
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) Portable 서버가 실행 중이어야 합니다 (기본: `localhost:8188`)

### 설치

```bash
git clone <repository-url>
cd comfyui_asset_manager
npm install
```

### 개발 모드

```bash
npm run dev
```

Electron 앱이 실행되며 렌더러에 HMR이 적용됩니다.

### 빌드

```bash
# 타입 체크 + 빌드
npm run build

# 플랫폼별 배포 패키지 생성
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

## 사용법

### 1. ComfyUI 연결

1. ComfyUI Portable 서버를 실행합니다
2. 앱 실행 시 자동 연결을 시도합니다 (기본: `localhost:8188`)
3. 연결 실패 시 **설정** 페이지에서 호스트·포트를 변경 후 연결합니다

### 2. 워크플로우 등록

1. **워크플로우** 페이지 → **워크플로우 가져오기** 클릭
2. ComfyUI에서 **Save (API Format)** 으로 저장한 JSON 파일을 선택합니다
3. 자동으로 변수가 감지되고 카테고리가 분류됩니다
4. **프롬프트 슬롯이 자동 감지**됩니다 — 각 CLIPTextEncode 노드가 KSampler에 어떻게 연결되었는지 분석하여 긍정/부정 프롬프트 역할을 판별합니다
5. 필요시 워크플로우 **상세** 모달에서 변수의 역할을 수동으로 변경합니다

> ⚠️ UI 형식이 아닌 **API 형식** JSON만 지원합니다. ComfyUI에서 `Save (API Format)` 버튼으로 저장하세요.
>
> 💡 멀티 모델 워크플로우(예: Anima + ILXL 2단계 생성)의 경우, 각 모델의 프롬프트 슬롯이 별도로 감지됩니다.

### 3. 프롬프트 모듈 만들기

1. **프롬프트 모듈** 페이지 → **새 모듈** 클릭
2. 모듈 이름, 타입(캐릭터/복장/감정 등)을 설정합니다
3. 모듈을 선택하고 **아이템 추가**로 프롬프트 아이템을 등록합니다
4. 각 아이템에 프롬프트, 네거티브 프롬프트, 가중치를 설정합니다

**프롬프트 예시:**
```
1girl, {{character_name}}, {red hair|blonde hair|silver hair}, masterpiece
```

### 4. 배치 작업 생성

1. **배치 작업** 페이지 → **새 배치 작업** 클릭
2. 작업 이름을 입력하고 생성용 워크플로우를 선택합니다
3. **프롬프트 슬롯 매핑**: 감지된 프롬프트 슬롯이 표시됩니다
   - **"모듈 프롬프트 주입"**: 모듈에서 조합된 프롬프트가 이 슬롯에 주입됩니다
   - **"고정값 사용"**: 워크플로우의 기존 값을 유지하거나 직접 입력합니다
4. **매트릭스에 모듈을 추가**하고 각 모듈에서 사용할 아이템을 선택합니다
5. 조합당 생성 수, 시드 모드, 출력 패턴을 설정합니다
6. 하단의 미리보기에서 총 조합·이미지 수를 확인합니다
7. **배치 작업 생성** 클릭

### 5. 실행 & 모니터링

1. **큐 모니터** 페이지에서 생성된 작업을 확인합니다
2. **시작** 버튼으로 실행합니다
3. 실시간으로 진행률을 확인하고 필요시 일시정지·취소합니다

### 6. 결과 확인

1. **갤러리** 페이지에서 생성된 이미지를 확인합니다
2. 평점·즐겨찾기로 선호하는 이미지를 관리합니다
3. 출력 폴더에서 `{작업명}/{캐릭터}/{복장}/{감정}/` 구조로 파일을 확인합니다

## 테스트

```bash
# 전체 테스트 실행
npm test

# 감시 모드 (파일 변경 시 자동 재실행)
npm run test:watch

# 커버리지 리포트
npm run test:coverage
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 39 + electron-vite |
| 프론트엔드 | Vue 3, Pinia, Vue Router, Vue I18n |
| UI 라이브러리 | Naive UI |
| 언어 | TypeScript 5.9 |
| 데이터베이스 | sql.js (in-memory SQLite, WASM) |
| HTTP 클라이언트 | ofetch |
| WebSocket | ws |
| 빌드 | Vite 7, electron-builder |
| 테스트 | Vitest, sql.js (in-memory test DB) |
| 코드 품질 | ESLint (flat config), Prettier |

## 프로젝트 구조

```
src/
├── main/                          # Electron 메인 프로세스
│   ├── index.ts                   # 앱 진입점
│   ├── ipc/                       # IPC 통신
│   │   ├── channels.ts            # 채널 상수
│   │   └── handlers.ts            # 핸들러 등록
│   └── services/
│       ├── database/              # sql.js DB 레이어
│       │   ├── index.ts           # 초기화, 스키마, 영속화
│       │   └── repositories/      # 리포지토리 패턴 (CRUD)
│       ├── comfyui/               # ComfyUI 서비스
│       │   ├── client.ts          # REST API 클라이언트
│       │   ├── websocket.ts       # WebSocket 연결
│       │   ├── manager.ts         # 싱글턴 매니저
│       │   ├── workflow-parser.ts  # 워크플로우 파서
│       │   └── types.ts           # ComfyUI 타입 정의
│       ├── prompt/                # 프롬프트 엔진
│       │   └── composition-engine.ts
│       └── batch/                 # 배치 실행
│           ├── task-generator.ts  # 카르테시안 곱 생성
│           └── queue-manager.ts   # 큐 매니저
├── preload/                       # 컨텍스트 브리지
└── renderer/src/                  # Vue 3 SPA
    ├── App.vue                    # 루트 (테마, i18n, IPC 이벤트)
    ├── components/layout/         # 레이아웃
    ├── stores/                    # Pinia 스토어 (6개)
    ├── views/                     # 페이지 (7개)
    ├── types/                     # 공유 타입
    └── locales/                   # i18n (ko, en)
```

## 라이선스

MIT
