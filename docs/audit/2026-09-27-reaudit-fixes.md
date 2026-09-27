# ComfyUI Asset Manager — 재점검 반영 결과 (2026-09-27)

기준: `b503390328dcd23e1d4853361136fdfe9a075807` → `maintenance/reaudit-fixes-20260927`. 이전 감사 수정은 유지한 채 후속 변경을 구현했습니다. main 병합·원격 푸시는 수행하지 않았습니다.

## 구현 순서와 결과

### 실행 서버·작업 제어

ComfyUI REST client의 서버 주소를 불변으로 만들고 실행 중 client·서버 주소·client ID를 고정했습니다. IPC와 MCP가 같은 manager 정책을 사용하여 다른 주소로의 전환을 거부하고 같은 주소 재연결은 허용합니다. 연결 확인 중 실행이 시작되는 경합도 재검사합니다.

`batch_tasks.comfyui_server_url`을 마이그레이션으로 추가하고 외부 제출 전 `submitting`과 함께 저장합니다. 재시작 후 다른 서버의 수락 요청을 조회·재제출하지 않습니다. 주소를 기록하지 않던 버전의 이미 수락된 요청은 자료를 보존하지만 자동 재개하지 않습니다. 원래 서버 결과·파일을 먼저 검토해야 합니다. 재연결은 기록된 주소(정규화된 host/port) 기준이며 다른 별칭을 임의로 같은 서버로 취급하지 않습니다.

작업 상태 바는 목록의 첫 paused 항목 대신 실제 `currentJobId`를 우선합니다. 같은 주소 복구·다른 주소 차단·프로세스 DB 재개방은 실제 실행기와 두 loopback 가짜 서버로 확인했습니다. 실제 GPU 생성은 하지 않았습니다.

### 프롬프트·화면 정합성

build/preview가 공통 순수 composer를 사용하고 wildcard 해석 여부만 구분합니다. 0 가중치·negative 모듈 가중치를 보존하고 비네거티브 모듈의 레거시 item.negative를 무시하는 정책은 유지했습니다. 더 이상 사용되지 않는 fragment 조립 API와 전용 테스트도 함께 제거했습니다.

queue/gallery/history의 마지막 요청·무효화 규칙을 `src/renderer/src/utils/latest-request.ts`로 공유합니다. 요청 목표 페이지와 표시 완료 페이지를 구분하고, 성공한 평점/즐겨찾기 변경 뒤 이전 조회 응답이 화면을 되돌리지 않도록 합니다. 실패는 갤러리 화면의 재시도 가능한 경고로 남깁니다.

### 태그·배포·미사용 코드

태그 transport 결과를 found/not_found/unavailable로 구분했습니다. 통신 실패는 valid=null이며 실패를 캐시하지 않습니다. 이미 로컬에 있는 태그만 검증할 때는 HTTP 요청을 하지 않고 정규화 중복을 한 번만 계산합니다. 태그 캐시는 만료시간과 크기 제한을 갖습니다. wildcard 이외의 괄호·정규식 문자는 리터럴로 처리합니다. 유사어는 두 행 거리 계산과 안정된 top-k로 동일한 순위를 더 적은 할당·정렬로 계산합니다.

배포 설정을 out/resources/package.json/LICENSE 허용 목록으로 바꾸고 production 의존성의 builder 수집은 유지했습니다. 실제 matcher canary 검사와 Linux unpacked app.asar 검사를 모두 수행했습니다. 최상위 파일은 `LICENSE, node_modules, out, package.json, resources`뿐이며, 금지된 앱 개발 자료는 발견되지 않았습니다. 12개 production 의존성·sql.js WASM·node-pty native 파일·태그 리소스가 보존됐습니다. native rebuild와 앱 실행은 별도 검증 범위입니다.

제품 소비자가 없는 BatchJobRepository.list(), 전역 interrupt 호출, gallery.setPage와 내부 IPC 5종을 정리했습니다. 공유 repository의 실제 사용 메서드, 파일 가져오기, 전역 서버 중단 방지·불확실한 결과·rollback·journal 검사는 보존했습니다.

### 성능

pending/retrying 전용 부분 인덱스와 `(job_id, created_at)` 복합 인덱스를 적용했습니다. 최근 결과 패널은 COUNT 없는 조회를 사용합니다. MCP 상태는 큰 스냅샷 없이 요약을 읽고, DB 변경이 없을 때 제한된 크기의 상태 캐시를 공유합니다. raw UPDATE, transaction rollback, export로 인한 연결 재설정, DB 재개방을 모두 무효화에 반영하며 실행기 활성 상태는 매번 다시 계산합니다.

## 측정

같은 Node v24.14.0·Linux arm64·동일 합성 데이터에서 이전/이후/이후/이전 순서로 실행했습니다. 버전별 준비 5회 후 표본 15개씩, 합산 30개 표본 중앙값입니다. 대기 태스크는 마지막 100개가 대기 중인 조건, 갤러리는 작업별 8개 조건입니다. 반환 태스크·이미지·완전한 상태 응답·태그 추천 순위의 동등성을 assertion으로 검증했습니다.

| 10만 건 기준                 | 이전(ms) | 이후(ms) |
| ---------------------------- | -------: | -------: |
| 대기 태스크 100개            |   27.786 |    1.513 |
| 최근 이미지 8개 + COUNT      |  137.433 |    9.686 |
| DB 변경 없는 MCP 상태 재조회 |   20.705 |    0.014 |
| DB 변경 후 MCP 상태 조회     |   22.294 |   19.796 |
| 태그 오타 10개, 6,549개 목록 |   199.83 |    91.24 |

COUNT 없는 새 최근 결과 전용 조회는 0.212ms였습니다. 페이지 전체 개수를 반환하는 API와 계약이 다르므로 단순 동일 조회 개선율로 해석하지 않습니다. MCP의 빠른 재조회도 **DB 변경이 없을 때**의 결과이며 변경 직후 집계 비용은 표에 분리했습니다.

인덱스는 무료가 아닙니다. 2,000개 상태 일괄 전환은 7.093 → 9.608ms, 합성 DB는 37,568,512 → 40,521,728 bytes로 늘었습니다. 이 수치는 SQL 구간과 DB 파일 크기이며 실제 UI 전체·GPU 생성·fsync 또는 Windows 성능 측정이 아닙니다.

## 검증과 보존

- 전체 검증: **87개 파일 / 887개 테스트**, lint, main/renderer/tests 타입 검사, 기존 커버리지 게이트, production bundle 모두 통과.
- 설정된 커버리지 집계 범위 Lines 85.03%. 전체 UI를 포함한 애플리케이션 전수 커버리지라는 의미는 아닙니다.
- 실제 Linux arm64 unpacked 패키지 생성 및 archive 파일/의존성 목록 확인 통과. Windows 설치·native PTY 작동·GUI·실제 ComfyUI/GPU 미검증.
- 기존 사용자 DB·파일·CLI 설정은 건드리지 않았고 테스트는 임시 데이터와 로컬 가짜 서버를 사용했습니다.
- 썸네일 캐시·DB 엔진 교체·범용 DI/상속 계층·대규모 상태 머신은 도입하지 않았습니다.

원자료는 작업 checkout의 `.reports/reaudit-fixes-20260927/`에 있습니다. `verify.json`, `package-inventory.json`, `benchmark-results.json`과 `benchmark.cjs`가 실행 결과·재현 근거입니다. `.reports`는 버전 관리와 배포 앱에서 제외됩니다.
