# 2026-09-05 유지보수 복잡성 감사

중복 상태·파싱·초기화와 실제 오류를 숨기는 우회 처리를 정리했다. 변경 전 전체 검사
749개와 변경 후 810개가 통과했다. 실제 Electron 실행에서도 배치 시작·파일 저장·갤러리
표시·네이티브 터미널 생성을 확인했다. 활성 PowerShell을 남긴 앱 종료에서는 네이티브
오류가 발생했으므로 해당 경로까지 정상이라고 판단하지 않는다.

## 범위와 기준 상태

- 기준 커밋: `44ebaaa`, `main`. 시작 시 작업 트리는 깨끗했다.
- Windows, Node `24.14.0`, npm `11.14.1`, Electron `41.10.7`, node-pty `1.1.0`.
- `AGENTS.md`, main 초기화·종료, preload·IPC 계약과 검증, DB writer·repository,
  배치 생성·실행·복구, ComfyUI import·preparation·검증, MCP 등록·파일·CLI 설정,
  renderer 화면·스토어, 테스트·의존성·빌드·CI·릴리스 설정을 조사했다.
- 호출부와 공개 등록·저장 형식을 함께 확인했다. 미사용 검색 결과나 줄 수만으로
  삭제하지 않았고, 기존 데이터·보안·복구 계약은 유지했다.
- 배포·push·릴리스·유료 서비스·운영 데이터 변경은 수행하지 않았다.
  DB·출력·CLI 설정 쓰기 검증은 임시 경로에서만 실행했다.

## 구현한 변경과 판단 근거

우선순위 P1은 데이터 보존·실패 상태, P2는 주요 실행 경로의 기능·상태 일관성,
P3는 그 경로에서 확인된 중복 계약·의존성·설명을 뜻한다.

| 우선순위 | 변경과 주요 파일                                                                                                                                                                                            | 불필요하다고 판단한 근거와 효과                                                                                                                                                                                               | 회귀 위험 및 보호                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | [DB 초기화와 기존 컬럼 추가](../../src/main/services/database/index.ts)                                                                                                                                     | 기존 컬럼 추가 4곳이 모든 SQL 오류를 이미 존재하는 컬럼으로 취급했다. `PRAGMA table_info`로 존재를 확인하고 실제 ALTER 실패는 전파한다. 초기화에 성공한 DB만 전역에 공개한다.                                                 | 기존 스키마·기본값·데이터를 유지했다. 실제 sql.js DB로 업그레이드·재초기화, 실패 시 파일 바이트 보존·미완성 DB 접근 차단·재시도를 검사했다.                                                                                                                        |
| P1       | [MCP CLI 설정 병합](../../src/main/services/mcp/config-generator.ts)                                                                                                                                        | 읽기·JSON 오류를 새 설정으로 덮는 fallback이 다른 서버 설정을 잃게 할 수 있었다. 객체 형태를 확인하고 실패하면 기존 파일을 보존하며 기존 IPC 오류 응답으로 전달한다.                                                          | 정상 병합과 다른 서버 항목은 유지한다. 손상 JSON·배열·원시값·잘못된 `mcpServers`·읽기 오류에서 파일과 후속 클라이언트 설정 보존을 검사했다.                                                                                                                        |
| P1/P3    | [MCP 파일 읽기](../../src/main/services/mcp/file-parser.ts), [파일 쓰기](../../src/main/services/mcp/file-serializer.ts), [도구 설명](../../src/main/services/mcp/tools/file-sync.ts)                       | `resolve()` 뒤의 절대경로·정규화 비교는 경로 탈출 차단 기능이 없는 중복 검사였다. 실제 크기·파일·부모 디렉터리 검사는 유지했다. 기존의 덮어쓰기 거부를 `wx` 배타적 생성으로 보장하고, 실제 동작과 반대였던 설명을 고쳤다.     | 상대·점 경로의 기존 해석과 오류 문구를 유지했다. 존재 확인 직후 다른 writer가 만든 파일, 기존 파일, ENOSPC, 파일 크기·형식·경로 오류를 임시 파일로 검사했다. renderer 자산 접근 허용 범위를 바꾼 것은 아니다.                                                      |
| P2       | [모듈 import IPC](../../src/main/ipc/handlers.ts), [입력 검증](../../src/main/ipc/validators.ts)                                                                                                            | 자체 export의 DB 소유 필드를 엄격한 편집 검증기에 그대로 넘겨 `Unknown module field: id`로 실패했다. 편집 내용만 투영해 공통 검증기를 한 번 사용하고 기본값은 repository에 맡겼다.                                            | 공개 export 형식과 새 ID 생성·import 응답을 유지한다. 활성 여부·가중치 0·metadata·prompt variants를 보존한다. 생성용 필드 허용 목록은 넓히지 않았다. 실제 등록 handler와 sql.js로 왕복·잘못된 입력·INSERT/UPDATE 실패 전체 롤백을 검사했다.                        |
| P2       | [queue store](../../src/renderer/src/stores/queue.store.ts), [Jobs](../../src/renderer/src/views/JobsView.vue), [Gallery](../../src/renderer/src/views/GalleryView.vue)                                     | Jobs의 전체 목록과 store의 변환된 활성 목록이 같은 작업을 따로 소유했고, 마운트·시작 후 목록 IPC가 3회였다. 하나의 전체 목록에서 활성·완료 목록을 계산해 1회로 줄였다. 진행 이벤트의 절대 개수를 사용해 중복 증가도 제거했다. | DB 목록과 실시간 `QUEUE_STATUS`는 역할이 달라 둘 다 유지한다. 진행 중 요청과 대기 갱신을 병합하고 오래된 응답이 최신 이벤트를 덮지 않게 했다. 일시정지 ETA·재실행 초기화·복구 필드·취소·화면 이탈을 검사했다. 전체 목록이 store 수명 동안 남는 메모리 차이는 있다. |
| P2       | [배치 task generator](../../src/main/services/batch/task-generator.ts)                                                                                                                                      | 선택 항목 배열과 별도 모듈 ID 배열의 인덱스를 맞출 필요가 없었다. 항목에 모듈 ID를 함께 보관하고 슬롯의 prefix/prompt/suffix 결합 3분기를 한 곳으로 모았다.                                                                   | 필요한 조합만 계산하는 lazy 구조와 순서·시드·프롬프트 의미를 유지했다. 누락·비활성·반복 모듈, 전역·지정·빈 슬롯, 고정값을 함께 검사했다. 빈 지정 슬롯에 전역 프롬프트가 섞이지 않는다.                                                                             |
| P2       | [workflow parser](../../src/main/services/comfyui/workflow-parser.ts), [import](../../src/main/services/comfyui/workflow-import.ts), [preparation](../../src/main/services/comfyui/workflow-preparation.ts) | 같은 그래프의 JSON 파싱·역할 분석·복제가 반복됐다. 검증된 노드 읽기와 역할 분석을 공유해 preparation 파싱을 5회에서 2회, 역할 분석을 2회에서 1회로 줄이고 그래프 clone을 없앴다. 일반 import 파싱도 2회에서 1회가 됐다.       | 최종 직렬화 후 재파싱은 저장 JSON의 숫자 정규화와 최종 10MB 제한에 필요해 유지했다. `1e400`, `-0`, 입력 변경 후 역할·기본값, 원본 보존·토큰·실제 저장 계약을 검사했다. 호출 횟수는 코드 경로 비교이며 성능 벤치마크 결과는 아니다.                                 |
| P2       | [위자드 모듈 선택](../../src/renderer/src/components/jobs/WizardStepModules.vue)                                                                                                                            | IPC 결과를 공용 `currentItems`에 쓴 뒤 다시 읽는 중간 단계를 거쳤다. 동시 선택 시 다른 모듈의 응답이 섞일 수 있어 요청 결과를 직접 소비한다.                                                                                  | 선택 필터와 기존 순서를 유지한다. 응답 완료 순서가 바뀌어도 각 모듈의 항목이 연결되는 지연 응답 테스트를 추가했다.                                                                                                                                                 |
| P2       | [터미널 패널](../../src/renderer/src/components/terminal/TerminalPanel.vue)                                                                                                                                 | store의 패널 열기와 component mount가 동시에 첫 탭을 생성해 네이티브 PTY가 2개 만들어졌다. 초기 생성 책임을 기존 store 한 곳에 남겼다.                                                                                        | 지연되는 생성 IPC를 사용해 첫 열기 1회·빈 탭 닫기·재열기를 검사했다. 실제 Electron에서도 네이티브 PTY 1개 생성과 PowerShell 출력을 확인했다. 활성 PTY 종료 오류는 별도 한계로 기록한다.                                                                            |
| P2       | [CLI 설정 화면](../../src/renderer/src/views/SettingsView.vue), [한국어](../../src/renderer/src/locales/ko.json), [영어](../../src/renderer/src/locales/en.json)                                            | store가 이미 갱신한 설정 상태를 화면에서 다시 조회했고, 실패 응답은 화면에 드러나지 않았다. 조회를 1회로 유지하고 반환 실패와 예외를 기존 메시지 UI로 전달한다.                                                               | 두 언어 모두 성공 상태 갱신과 실패 메시지를 mounted component 테스트로 검사했다. 실제 사용자 CLI 설정은 쓰지 않았다.                                                                                                                                               |
| P3       | [MCP 등록 테스트](../../tests/main/services/mcp/tools-registration.test.ts), [package](../../package.json), [lockfile](../../package-lock.json)                                                             | 가짜 SDK 객체로 등록을 다시 구현하던 테스트를 기존 실제 SDK transport 테스트에 통합했다. 직접 사용하는 `zod`를 SDK의 전이 의존성 배치에 맡기지 않도록 직접 선언했다.                                                          | 고유한 prompt 이름·설명·인자 검증과 40개 도구의 순서·스키마·annotations 검증을 유지했다. leaf 의존성·잠금 버전·커버리지 임계값은 바꾸지 않았다.                                                                                                                    |

## 검증

처음 sandbox 안에서 수행한 검증은 자식 프로세스 생성 `EPERM`으로 중단됐다.
`npm run doctor`에서 Node·의존성·Electron 설치는 정상이고 esbuild 자식 실행이 막힌 것을
확인한 뒤, 승인된 로컬 프로세스 권한으로 기준 검사를 다시 수행했다. 이 환경 실패를
기존 애플리케이션 실패나 성공으로 계산하지 않았다.

| 실제 실행                                                                                                  | 결과                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 변경 전 `npm run verify:coverage`                                                                          | exit 0. lint, main·web·tests 타입 검사, 70개 파일/749개 테스트, coverage, Electron bundle 빌드 통과. 2026-09-05 13:09:44–13:10:52 KST.                                                                            |
| `npm test -- tests/main/services/database/index.test.ts tests/main/services/database/repositories.test.ts` | 변경 후 2개 파일/103개 테스트 통과. 새 migration 실패 테스트는 수정 전 실패를 확인했다.                                                                                                                           |
| 단위별 `npm test -- <관련 test 파일>`                                                                      | generator·batch·주입·MCP 5개/68개, module IPC·validators 3개/80개, workflow 경로 7개/69개, MCP 파일·등록 경로 6개/61개, 설정 생성·IPC 2개/39개, renderer 주요 경로 7개/42개, CLI 설정·store·locale 4개/11개 통과. |
| `npm run typecheck:node`, `npm run typecheck:web`, `npm run typecheck:test` 및 관련 파일 ESLint            | 각 구현 단위 검사와 최종 통합 검사에서 통과. 새 fixture의 타입 오류와 변경된 화면 handler 참조는 통합 검사 전 수정했다.                                                                                           |
| 최종 `npm run verify:coverage`                                                                             | exit 0. lint, 타입 검사 3종, 77개 파일/810개 테스트, coverage, main·preload·renderer bundle 빌드 통과. 2026-09-05 13:30:35–13:31:11 KST.                                                                          |
| `npm ls zod --all`                                                                                         | 앱과 MCP SDK가 설치된 `zod@4.3.6`을 공유함을 확인했다. 버전 업그레이드는 없다.                                                                                                                                    |
| `node .reports/slop-audit/electron-smoke.cjs`                                                              | 실제 Electron·sandbox preload·renderer IPC·네이티브 PTY를 사용하는 smoke. 정상 셸 종료 후 앱 종료까지 6개 확인 항목 통과, exit 0. 활성 PTY를 남긴 이전 실행은 종료 실패로 별도 보존했다.                          |
| `node .reports/slop-audit/pty-shutdown-probe.cjs`                                                          | HEAD의 실제 PTY manager·종료 함수를 사용한 독립 재현 1회는 exit 0, stderr·timeout 없음. BrowserWindow와 나머지 서비스를 제외한 최소 재현에서는 전체 앱의 종료 오류가 재현되지 않았다.                             |
| `git diff --check`                                                                                         | 통과. 공개 형식·등록·보호 분기와 새 테스트를 포함한 최종 diff를 검토했다.                                                                                                                                         |

새 회귀 테스트로 수정 전 실패를 확인한 주요 사례는 자체 module export/import,
DB ALTER 오류 은폐, MCP 파일 생성 경쟁, 손상된 CLI 설정 덮어쓰기, 동시 위자드 응답,
터미널 첫 실행 중복, CLI 설정 중복 조회·실패 미표시다. 기존 테스트의 skip이나
coverage 임계값 완화 없이 고유한 검사 조건을 보존·보강했다.

| 전체 coverage | 변경 전 | 변경 후 |
| ------------- | ------: | ------: |
| Statements    |  78.77% |  81.04% |
| Branches      |  73.74% |  77.12% |
| Functions     |  77.83% |  80.12% |
| Lines         |  79.95% |  82.14% |

coverage는 실행된 코드 범위이며 실제 모델·이미지 품질이나 모든 장애 조합의 증명은 아니다.
최종 통합 결과의 모든 단계가 exit 0이고 `incomplete.json`이 없음을 확인했다.
원본 결과와 단계 로그는 로컬의 [기준 결과](../../.reports/slop-audit/baseline/latest.json),
[최종 결과](../../.reports/verify/latest.json), [smoke 결과](../../.reports/slop-audit/smoke-result.json),
[활성 PTY 종료 실패](../../.reports/slop-audit/smoke-active-pty-shutdown.json)에 보관했다.
`.reports/`는 Git 제외 경로이므로 이 문서는 결과를 자체적으로 요약한다.

### 실제 Electron 사용 경로와 한계

격리한 userData·DB·출력 폴더와 localhost HTTP/WebSocket ComfyUI fixture를 사용했다.
실제 외부 ComfyUI 서버·GPU·개인 PowerShell profile은 사용하지 않았다. 파일 선택은
임시 workflow 파일로 연결했고, CLI 설정 쓰기·삭제 IPC는 harness에서 차단했다.

1. 빌드한 앱과 sandbox preload를 로드하고 Jobs 화면·서버 연결을 확인했다.
2. 실제 renderer IPC로 모듈 export/import 후 비활성 값·가중치 0을 확인했다.
3. Jobs 재진입 시 목록 요청 1회, 실제 시작 버튼 클릭, 서버 제출 1회, 완료 상태·출력 파일·gallery 행을 확인했다.
4. Gallery의 `local-asset:` 이미지가 로드됐는지 `complete`·`naturalWidth`로 확인했다.
5. 터미널 토글로 패널이 생성되고 실제 PTY 1개가 PowerShell 명령 출력을 반환하는지 확인했다.
6. 셸에 `exit`를 보내 네이티브 종료 이벤트를 받은 뒤 앱을 종료한 실행은 exit 0이었다.

활성 PowerShell을 남긴 앱 종료는 `node-pty/lib/conpty_console_list_agent.js`의
`AttachConsole failed`와 native exit `3221226505`로 실패했다. `pty-manager.ts`,
main 종료 코드, Electron·node-pty 잠금 버전은 변경 전과 동일하다. 이 사실만으로
원인이 변경 전부터 존재했거나 실제 사용자의 모든 종료에서 발생한다고 단정하지 않는다.
셸을 먼저 종료한 성공 결과로 이 실패를 대체하지 않았다.

추가로 HEAD의 실제 PTY manager·종료 함수와 같은 잠금 의존성을 사용한
[독립 재현](../../.reports/slop-audit/pty-shutdown-probe.json)을 1회 실행했지만 오류가
재현되지 않았다. BrowserWindow 없이 queue·MCP·DB·connection을 비활성 객체로
대체했으므로 전체 앱의 결과와 동등하지 않다. 따라서 기존 문제인지 이번 변경의
회귀인지는 아직 분류하지 못했다.

## 보류한 후보

| 후보                                                                                  | 보류 이유와 필요한 판단                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipelines`, `presets`, `saved_seeds` 테이블, `auto_save_interval`, `pipeline_config` | 일부 실행 소비가 없거나 제한적이어도 기존 저장 데이터·설정 허용 목록·공개 레코드·배치 저장 경로에 남아 있다. 삭제하려면 별도 폐기·마이그레이션 정책이 필요하다.                                                           |
| renderer 소비가 없는 dashboard IPC와 일부 상수·스토어 메서드                          | IPC 등록과 공용 계약이 존재하거나 삭제 효과가 작다. 검색 결과만으로 공개 계약을 축소하지 않았다.                                                                                                                          |
| DB 직렬 writer·임시 파일 복구·출력 journal·`uncertain`·legacy queue 분기              | 중복처럼 보여도 저장 실패·프로세스 종료·응답 유실·레거시 작업을 각각 보호한다. 고유한 fault/crash 회귀 테스트가 있어 유지했다.                                                                                            |
| prompt 생성과 미리보기 구현의 유사 부분                                               | wildcard 평가와 negative 가중치 의미가 다르다. 동일 동작으로 가정해 통합하면 결과가 달라질 수 있다.                                                                                                                       |
| `scripts/verify.mjs`의 package script와 비슷한 직접 실행 명령                         | Windows shim을 피하고 단계 결과를 수집하는 역할과 동기화 테스트가 있다. 단순 래퍼로 보고 제거하지 않았다.                                                                                                                 |
| MCP 여러 클라이언트 설정 생성·삭제 전체 재설계                                        | 보조 클라이언트 실패가 부분 성공으로 남고 삭제 중 오류가 후속 처리를 막을 수 있다. 결과 계약·부분 성공 UI·원자적 파일 교체 정책을 함께 정해야 한다. 이번에는 주 `.mcp.json` 손상 시 덮어쓰기와 화면의 실패 은폐만 고쳤다. |
| 활성 Windows PTY의 앱 종료 오류                                                       | 네이티브 자식 프로세스 종료 문제다. 앱·의존성 수정의 충분한 원인 근거 없이 dependency 교체나 오류 억제를 추가하지 않았다.                                                                                                 |

## 남은 위험과 미검증 영역

- Windows의 활성 PTY 종료 오류를 별도 재현·수정해야 한다.
- 실제 GPU·커스텀 ComfyUI 노드·모델 생성 품질과 실제 CLI 클라이언트 연동은 검증하지 않았다.
- Windows installer/portable 패키지 생성·설치, Ubuntu CI, 릴리스 검증은 실행하지 않았다.
  이번 통과 범위는 로컬 통합 게이트와 설치된 Electron에서 빌드 결과를 실행한 smoke다.
- CLI 설정 파일 쓰기는 여전히 여러 파일을 아우르는 트랜잭션이나 동시 편집 보호를 제공하지 않는다.
- Jobs 전체 레코드를 공유 store에 유지하므로 매우 큰 작업 이력에서 메모리 비용을 따로 측정할 필요가 있다.
- 검사한 범위 밖까지 저장소 전체가 안전하다고 판단하지 않는다.
