# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

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
