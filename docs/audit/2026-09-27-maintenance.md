# 2026-09-27 감사 개선 적용 결과

## 범위

기준은 `e213d45525b73662b68f3c17f17322987096e9ae`다. 별도 worktree
`/workspace/.tia/audits/comfyui-asset-manager-20260927`, 브랜치
`maintenance/audit-fixes-20260927`에서 정합성 → 화면 동기화 → 조회/집계 성능 →
미사용 코드와 테스트·문서 순서로 적용했다. main 병합·push·배포·릴리스와 사용자 DB 변경은 수행하지 않았다.

## 적용 사항

### 1. DB 저장과 참조 무결성

[DB 서비스](../../src/main/services/database/index.ts)의 async/sync export 경로가
sql.js 연결 재개방 직후 외래키 등 연결 정책을 다시 설정한다. 비동기 파일 I/O 전에 복원하며
직렬 writer, 임시 파일 교체, fsync, 저장 재시도, 종료 await를 유지했다.
동기 export도 미커밋 transaction 안에서는 거부한다.

[Repository](../../src/main/services/database/repositories/index.ts)의 태스크 제거는
갤러리의 `task_id`와 저장 시드의 `source_task_id`를 transaction 안에서 해제한다.
작업 제거 시 갤러리 `job_id`도 해제하되 갤러리 레코드·프롬프트·시드·원본 이미지 파일은 보존한다.
삭제 실패 시 참조 해제까지 롤백한다. 기존 고아 행은 검사 대상이지 자동 삭제 대상이 아니다.

외래키가 켜진 대량 삭제의 반복 child-table scan을 피하도록 이미지 `task_id`와
저장 시드 `source_task_id`에 인덱스를 추가했다. 새 DB뿐 아니라 기존 DB 재개방과
실제 SQL 실행 계획으로 인덱스를 확인했다. 워크플로우·모듈 삭제 실패도 화면에 표시한다.

### 2. 완료 처리와 정렬 조회

`BatchTaskRepository.finish()`가 활성 태스크의 terminal 전이와 작업 완료/실패 카운터를
같은 transaction에서 한 번만 갱신한다. 중복 완료·실패 호출이나 `uncertain` 태스크는
카운터를 증가시키지 않는다. 큐 바깥의 중복 진행률 쓰기와 성공마다 수행하던 전체 집계를 제거했다.
시작·복구·미확정 결과 대조는 계속 전체 상태를 확인한다.

`(job_id, sort_order)` 복합 인덱스로 다음 태스크 순서 조회를 처리하며,
중복되는 기존 `job_id` 단일 인덱스는 교체했다. 출력 journal, 제출 전/수신 후/결과 커밋 후
내구성 확인, 불확실한 요청 자동 재제출 금지와 legacy task 실행은 유지했다.

### 3. 외부 작업과 화면 상태

[공통 BatchJobService](../../src/main/services/batch/batch-job-service.ts)의 생성/편집 성공과
IPC 삭제/정렬 변경에 병합 가능한 갱신 알림을 연결했다. 큐 시작·일시정지·재개·취소의
실제 상태 이벤트를 renderer가 구독한다. App은 설정 로딩을 기다리기 전에 이벤트를 등록한다.

큐 상태는 store가 소유하며 이전 polling 결과가 최신 이벤트를 덮지 않는다.
목록에 없던 작업의 태스크 이벤트도 재조회로 연결하고, 재조회 오류는 화면 상태에 남긴다.
생성/재실행 뒤의 임의 300ms 대기를 없앴다. 알림은 UI invalidation일 뿐 DB 내구성 보장을 대신하지 않는다.

### 4. 가벼운 목록과 상세 조회

`BatchJobSummary` / `BatchJobRecord` / `BatchJobPage`로 역할을 구분했다.
현재·주의 작업은 스냅샷 없는 요약으로, 완료 이력은 서버에서 50개씩 조회한다.
`uncertain` 결과는 완료 상태라도 이력 뒤에 숨기지 않는다. 편집·복제할 때만 `BATCH_GET`으로
상세 설정을 읽는다. 페이지 이동 중 현재 작업이 갱신되어도 사용자가 요청한 페이지를 유지한다.

내부 `BATCH_LIST` 응답은 배열에서 페이지 객체로 변경했다. 대응 renderer와 IPC 검증을 함께
변경했고 기존 MCP 도구 이름·목록 계약은 유지했다. 페이지/크기/범위/offset 검증과 결과 내
config·snapshot 부재를 검사했다.

### 5. 모듈과 미사용 경로

[모듈 화면](../../src/renderer/src/views/ModuleView.vue)은 선택 변경 시 기존 상세를 비우고,
무효화된 metadata·item·preview 응답을 반영하지 않는다. 화면 이탈도 요청을 무효화한다.
모듈 복제는 비활성 아이템의 `enabled` 값을 보존한다.

현재 소비자가 없는 옛 CharacterRepository/캐릭터 CRUD IPC·validator·전용 테스트,
대시보드 handler/계약, 선언만 있던 갤러리 채널, 쓰이지 않는 preview base64 전송과 raw 실행 이벤트
중계를 제거했다. 현재의 `character` 타입 프롬프트 모듈은 별개이며 유지했다.
main 내부 WebSocket 완료 대조, 연결 이벤트와 큐가 확정한 결과 이벤트는 제거하지 않았다.
legacy 테이블 및 `pipelineConfig`·`auto_save_interval` 저장 호환성은 보존했다.

## 테스트와 유지보수

Repository와 Queue 테스트에서 복제하던 스키마·transaction을
[실제 DB fixture](../../tests/helpers/database.ts)로 통합했다. 매 테스트 DB 종료와 임시 폴더
정리를 보장한다. 폐기한 기능 전용 테스트 4개를 제거하고, 고유한 회귀 조건은 보존·보강했다.
테스트 총수 감소를 목표로 삼지 않았으며 coverage 임계값은 낮추지 않았다.

README 구조·라이선스 참조, 기존 로컬 증거 링크, CHANGELOG와 필수 데이터 계약을 최신화했다.
MIT 표시에 대응하는 LICENSE 파일과 package metadata를 추가했다. 의존성·앱 버전은 올리지 않았다.
별도 ORM, 범용 repository 상속 계층, DI container, 전면 CQRS/상태 머신은 도입하지 않았다.

## 검증 결과

최종 환경은 Linux arm64, Node **24.14.0**(저장소 지정 버전), sql.js 1.14.1이다.
Node는 별도 도구 경로에 설치해 다른 작업공간의 기본 런타임을 바꾸지 않았다.

| 실행                                | 결과                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `npm run doctor -- --json`          | 전체 검사 통과                                                                |
| `npm run verify:coverage`           | exit 0, 모든 단계 passed, 216.09초                                            |
| 전체 테스트                         | **83개 파일 / 865개 통과**                                                    |
| lint, main/renderer/tests typecheck | 모두 통과                                                                     |
| 커버리지 게이트와 production bundle | 모두 통과; 집계 대상 Lines 83.67%                                             |
| `git diff --check`                  | 통과                                                                          |
| Electron smoke                      | fresh build/fixture 통과 후 앱 로딩 전 공유 라이브러리 오류; 실행 검증 미완료 |

최종 검증 시간은 2026-09-27 08:52:43–08:56:19 KST다. 중간 검사에서 새 테스트의 반환 타입·
미사용 변수 lint 오류를 발견해 수정했다. 첫 DB 회귀 6개는 수정 전 실패를 확인했다.
기존 큐 fault/crash·저널·불확실성·저장 실패 검사도 통과했다.

최종 결과와 로그는 `.reports/verify/`에 있다. 실행 중 표시 파일이 남지 않았는지 함께 확인한다.
실앱 smoke 기록은 `.reports/smoke/run-22tB5N/`이다. 기본 실행은 `libglib-2.0.so.0` 누락으로
Electron exit 127이며, 공용 라이브러리 경로를 조사해도 GTK/DBus와 디스플레이가 추가로 필요했다.
smoke의 임시 런타임과 fixture 정리는 passed다. sandbox나 webSecurity를 끄지 않았다.
실제 Windows UI·PTY 종료·설치 패키지, ComfyUI/GPU 생성, 사용자 운영 DB는 검증하지 않았다.

## 성능 실측

같은 Node·의존성으로 기준 커밋과 수정 소스를 각각 번들링했다. 합성 작업 501개(완료 500개,
작업별 약 104KB snapshot)와 태스크 50,000개를 사용했다. 별도 프로세스에서 전→후→후→전(ABBA),
각 실행 워밍업 3회 뒤 15회 측정으로 버전별 30개 표본을 모았다. 아래는 합친 표본의 중앙값이다.

| 지표                         |          변경 전 |      변경 후 |
| ---------------------------- | ---------------: | -----------: |
| UI용 repository 조회         |        363.779ms |      6.160ms |
| 조회 결과 JSON 크기          | 53,629,130 bytes | 12,168 bytes |
| 다음 sort_order 조회         |         15.232ms |      0.064ms |
| 완료 상태·카운터 transaction |         11.637ms |      0.245ms |

목록은 기존 전체 501개 상세 레코드와 새 현재 작업 1개+이력 첫 50개를 비교했다.
나머지 이력은 페이지 탐색으로 접근하며 총수도 반환한다. 같은 수의 상세 데이터를 더 빨리 전송했다는
뜻이 아니다. 크기는 JSON 직렬화 기준이며 실제 Electron IPC wire/RSS 측정이 아니다.
transaction 측정에는 GPU·이미지 다운로드·파일 저장·태스크별 flush가 포함되지 않는다.
이 수치를 앱 전체나 생성 처리량의 개선율로 확대 해석하지 않는다.

추가로 수정 코드에서 50,000개 태스크를 제거하면서 갤러리 5,000행과 시드 5,000행을 보존하고
`foreign_key_check`가 비어 있음을 확인했다. 두 실행은 587.95/601.73ms였다.
이 부하 검사는 이미지 메타데이터를 사용하며 원본 파일 보존은 별도 실제 임시 파일 회귀 테스트로 확인했다.

원표본·source SHA-256은 `.reports/maintenance/benchmark-results.json`, 측정 하네스는
`.reports/maintenance/benchmark-job-paths.cjs`에 보관했다. 재실행은 저장소 루트에서 지정된 Node로
`node .reports/maintenance/benchmark-job-paths.cjs`다. `.reports`는 Git 제외 로컬 근거이며,
하네스는 별도 검증 자료 묶음에도 포함한다.

## 남겨 둔 판단

실제 썸네일 생성·worker·증분 SQLite 전환은 Windows UX/메모리/패키징 실측 후 별도 작업으로 남긴다.
사용하지 않는 저장 컬럼·테이블을 일괄 제거하거나 과거 데이터를 자동 정리하지 않았다.
대형 repository 분해, 검증 모듈 전면 재배치, MCP registrar 재설계는 이번 결함 수정에 필요하지 않아
변경 범위를 확대하지 않았다. 현재의 공통 서비스·명시적 transaction·요약/상세 계약을 우선 활용했다.
