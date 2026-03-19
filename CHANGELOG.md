# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

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
