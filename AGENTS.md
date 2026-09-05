# Codex — ComfyUI Asset Manager

이 저장소의 에이전트 안내는 Codex용으로 이 파일에서 관리한다.
Electron + Vue 앱이며 ComfyUI API JSON 워크플로우로 대량 이미지를 생성한다.
사용법은 `README.md`, 실행 명령은 `package.json`, 변경 이력은 `CHANGELOG.md`를 참조한다.
과거 계획·감사·진행 기록은 당시 근거이며 현재 작업의 승인 조건이나 할 일 목록이 아니다.

## 작업 판단

- 검토만 요청받으면 발견 사항과 수정안을 제공한다. 변경도 요청받으면 구현과 관련 검증까지 완료한다.
  통상적인 구현·리팩터링 선택은 자율적으로 결정한다.
- 문맥으로 판단할 수 없는 입력이 결과를 크게 바꿀 때 질문한다. 선택적 선호는 합리적인 가정을 밝혀 진행하고,
  대상·필수 사실·승인이 필요한 경우에는 답변에 의존하는 작업만 보류한다. 독립적인 작업은 계속하며 침묵을 승인으로 간주하지 않는다.
- 기존 사용자 변경을 보존한다. 같은 대상·행위·범위에 대해 현재 대화에서 받은 승인은 재사용한다.
  별도의 실행 직전 확인을 명시적으로 요구하는 규칙은 유지하며, 과거 문서 때문에 재승인받지 않는다.
- 관련 영역의 코드와 테스트를 기준으로 판단한다. 이 파일에 구현 예제·버전별 구조·일반 코딩 방법론을 누적하지 않는다.

## 데이터와 실행 계약

- 갤러리의 “갤러리에서 제거”는 DB 항목만 제거하며 원본 이미지 파일을 보존한다.
- draft 편집은 작업 ID를 유지한다. 실행 이력이 있는 작업은 복제하여 새 설정을 적용한다.
- sql.js는 메모리 스냅샷을 파일로 저장한다. 단일 앱 인스턴스와 단일 직렬 writer를 유지하고,
  임시 파일 교체 실패를 원본 직접 쓰기로 우회하지 않는다. 정상 종료는 `closeDatabase()`를 await한다.
- Repository mutation이 저장을 예약한다. 여러 mutation은 `withTransaction()`으로 묶고
  handler/service에서 저장을 중복 예약하지 않는다. 구현은 `src/main/services/database/`에 있다.
- 새 DB 필드는 기존 DB 업그레이드 경로도 고려한다. 일반 update 허용 목록에는 외부에서 수정하도록
  의도한 필드만 추가한다. 서버 소유 필드를 새 컬럼이라는 이유로 공개하지 않는다.
- IPC/MCP 배치 생성·draft 수정은 `src/main/services/batch/batch-job-service.ts`를 공유한다.
  필요한 조합만 인덱스로 계산하며 전체 조합 배열을 미리 만들지 않는다.
  스냅샷 없는 레거시 작업의 실행 호환성을 유지한다.
- `max_retries`는 최초 시도 이후의 추가 시도 횟수다. `retrying`은 완료 상태가 아니며
  `batch.maxRetries`는 레거시 읽기 호환용이다.
- 외부 제출 전에 `submitting`을 flush하고 수신한 prompt ID를 보존한다. 응답 유실·완료 확인 실패는
  `uncertain`으로 격리하며 자동 재제출하지 않는다. 다운로드 재시도는 같은 prompt ID를 사용한다.
- 출력 journal은 파일 생성 전에 기록한다. 완료·gallery·진행률을 함께 커밋하고 DB flush 이후에만
  서버 history를 정리한다. 재시작 시 미해결 journal의 파일은 보존하고 재개·삭제·재실행을 막는다.
- 이미지 없는 완료 응답은 실패다. 태스크 완료와 gallery 기록은 같은 트랜잭션으로 처리하고,
  실패 시 해당 시도의 출력만 정리한다. 출력 경로는 `src/main/services/batch/output-path.ts`로 검증한다.
- 재실행은 연결·작업 상태를 먼저 검증하고 태스크 삭제·진행률 초기화를 트랜잭션으로 묶는다.
  복구·재개·취소는 프로세스 재시작으로 인메모리 상태가 사라진 경우도 처리한다.

## 프로세스와 외부 접근 경계

- Electron의 sandbox·webSecurity·CSP 보호를 유지한다. sandbox preload가 로드되도록
  `electron.vite.config.ts`에서 `@electron-toolkit/preload`를 인라인 번들링한다.
- 자산 표시·클립보드·탐색기 접근은 `src/main/services/assets/local-asset.ts`를 재사용한다.
  현재 출력 루트 또는 DB 등록 자산을 허용하되 realpath 탈출을 차단한다.
- 외부 파일 import는 main에서 선택과 읽기를 함께 수행한다. renderer가 임의 경로를 제출하는
  읽기 IPC로 분리하지 않는다. 새 창 외부 링크는 HTTP(S)만 허용한다.
- IPC의 타입 계약은 런타임 검증을 대신하지 않는다. renderer 입력은 `src/main/ipc/validators.ts`로
  검증하고, 채널·계약은 `src/shared/`, renderer 호출은 `invokeIpc()`를 사용한다.
- MCP는 localhost와 기본 Bearer 인증을 유지하며 `/health`만 공개한다.
  서버 시작·중지는 CLI 설정 파일을 변경하지 않고, 터미널 생성도 MCP를 활성화하지 않는다.
  앱에서 외부 CLI 설정 생성·제거는 Settings의 명시적 요청으로만 수행한다.
- 앱은 Codex 설정을 읽기만 한다. Codex 등록·해제는 `codex mcp add/remove`로 처리한다.

## 코드와 UI

- 코드 식별자·주석은 영어, 사용자 문서는 한국어로 작성한다. UI 문자열은 i18n을 사용하고
  `src/renderer/src/locales/ko.json`과 `en.json`을 함께 갱신한다. 언어 자체의 이름은 예외다.
- 공용 순수 타입·유틸은 `src/shared/`에서 직접 참조한다. JSON 구조 검증은 기존 safe-json helper를 재사용한다.
- main 로깅은 `src/main/logger.ts`의 electron-log를 사용한다. 사용자가 상태를 오판할 수 있는
  실패는 호출자나 renderer의 오류 상태로 전달한다.
- 화면 변경은 `src/renderer/src/components/common/`의 PageShell·PageHeader·확인 버튼·메뉴와 기존 스타일을 활용한다.
  앱 사용자가 실행하는 삭제·취소 등 파괴적 UI 액션에는 확인을 제공한다.

## 검증과 문서

- 변경 동작과 회귀 위험에 맞는 테스트를 선택한다. DB 저장·경로 접근·IPC 검증·큐 상태 변경은
  실패 경로와 데이터 보존을 검증한다. 단순 함수 추출을 이유로 구현을 복제한 테스트를 추가하지 않는다.
- 코드 변경은 관련 테스트와 타입 검사를 실행하고, 영향 범위가 넓거나 빌드·패키징을 건드리면
  전체 테스트·빌드로 넓힌다. 검증이 통과하면 새 근거 없이 반복하지 않는다.
- 문서만 변경하면 링크·참조·diff·서식을 확인한다. 앱 테스트와 빌드는 요구하지 않는다.
- 빠른 피드백은 `npm test -- <test-path>` 또는 `npm run test:related -- <source-path>`와
  관련 타입 검사를 사용한다. import 관계에 잡히지 않는 IPC·동적 fixture는 테스트를 직접 지정한다.
- 전체 검증은 `npm run verify`, CI와 같은 커버리지 게이트는 `npm run verify:coverage`다.
  main·renderer·tests 타입 검사를 포함하며 `.reports/verify/latest.json`과 단계별 로그를 남긴다.
  이전 성공을 재사용하지 말고 이번 실행의 상태와 종료 코드를 확인한다.
  `incomplete.json`이 있으면 미완료이며, 같은 체크아웃에서 통합 검증을 동시에 실행하지 않는다.
- 앱 수준의 격리 검사는 `npm run smoke`다. 준비·빌드·Electron 실행 실패와 실제 UI 검사 결과를
  구분하고 `.reports/smoke/run-*/result.json`의 상태·종료·정리 결과를 확인한다. 범위와 전제는
  `docs/development.md`를 따른다. `--existing-build` 결과는 현재 소스의 검증 성공이 아니다.
- 환경 문제는 `npm run doctor`로 진단한다. Node 버전은 `.node-version`을 사용하며
  CI는 Ubuntu·Windows에서 같은 검증을 수행한다. 상세 사용법은 `docs/development.md`에 있다.
  CI의 전체 품질 게이트는 `.github/workflows/ci.yml`, 배포 검증은 `.github/workflows/release.yml`에 정의되어 있다.
- 실제 결과와 미검증 영역을 보고한다. 과거 기록의 통과 결과를 이번 검증 결과로 사용하지 않는다.
- 문서는 설명이 바뀐 경우에만 수정한다. AGENTS는 지속적인 프로젝트 계약, README는 사용법,
  CHANGELOG는 변경 이력을 맡는다. 일반 변경은 Unreleased에 기록하고 릴리스 때 버전을 올린다.
- 릴리스는 호환성에 따라 SemVer를 적용하며 package·lockfile 버전과 날짜가 있는 CHANGELOG를
  맞춘다. 릴리스 커밋은 `v{version}: description`, 검증은 `npm run verify:release -- v{version}`을 사용한다.
