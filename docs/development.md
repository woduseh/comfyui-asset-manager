# 개발과 검증 루프

사람과 에이전트가 같은 명령과 결과를 사용합니다. 작업 계약은 [AGENTS.md](../AGENTS.md),
실행 명령은 [package.json](../package.json)이 기준입니다.

## 환경 확인

새 체크아웃에서는 `.node-version`의 Node.js를 선택한 뒤 `npm ci`로 설치합니다.
기존 작업 환경에 문제가 생겼을 때는 먼저 다음 진단을 실행합니다.

```bash
npm run doctor
npm run --silent doctor -- --json
```

Node 버전, 로컬 검증 도구, sql.js WASM, Electron 실행 파일, Vite가 사용하는 esbuild의
자식 프로세스 실행을 확인합니다. 설치·설정 변경·앱 실행은 하지 않습니다.
`spawn EPERM`/`EACCES`는 프로세스 실행 권한 문제일 수 있으므로 의존성 재설치에 앞서
샌드박스 권한을 확인합니다. Electron GUI와 네이티브 PTY의 실제 동작은 별도 확인이 필요합니다.

Windows에서 아래 검증을 실행하는 최소 조건은 지정된 Node.js·설치된 의존성과 자식
프로세스 생성, Chromium IPC, 자신이 실행한 프로세스 트리 종료가 허용되는 데스크톱
세션입니다. 도구가 설치되어 있는데 샌드박스에서만 접근이 거부되면, 해당 실행 도구의
명령별 승인 절차로 `doctor`, `verify:coverage`, `smoke`를 실행해 확인합니다. 보안 설정을
완화하거나 의존성을 재설치하는 절차는 아닙니다.

## 수정 중 빠른 피드백

```bash
# 특정 동작의 테스트
npm test -- tests/main/services/batch/queue-faults.test.ts

# 소스 파일을 정적으로 import하는 관련 테스트
npm run test:related -- src/renderer/src/stores/gallery.store.ts

# 특정 테스트를 반복 실행
npm run test:watch -- tests/renderer/gallery.store.test.ts

# 변경 영역의 타입 검사
npm run typecheck:node
npm run typecheck:web
npm run typecheck:test
```

`test:related`는 지정한 소스의 import 관계로 테스트를 고릅니다. IPC 문자열, 런타임 동적 경로,
자식 프로세스로 실행하는 fixture 등은 관계를 놓칠 수 있으므로 해당 통합 테스트를 직접
지정하거나 전체 검증을 실행합니다. 테스트를 찾지 못하면 실패하며 성공으로 처리하지 않습니다.
`typecheck:test`는 테스트와 fixture, Vitest 설정 및 참조하는 Vue 컴포넌트까지 검사합니다.

검증 도구를 수정했거나 esbuild 시작이 막힌 환경에서는 도구 자체의 실행 계약을 별도로
확인할 수 있습니다. Node와 설치된 의존성을 사용하며 제품 테스트·빌드·GUI 검사를 대신하지 않습니다.

```bash
npm run verify:tooling
npm run verify:tooling -- --inject-failure  # 의도한 assertion 실패, exit 1
```

실제 자식 실패와 후속 검사·로그, 취소 분류, 준비 실패, 입력 해시, 임시 서버의 포트 분리와
해제를 확인하고 `.reports/tooling/run-*/`에 결과와 로그를 보존합니다. 취소 시 프로세스
트리 종료가 거부되면 `processTree: permission-denied`로 표시합니다. 도구 계약 통과는 그
환경에서 정상적인 트리 종료나 앱 실행이 가능하다는 뜻이 아닙니다.

## 전체 검증과 실패 분석

```bash
npm run verify           # lint → 타입 검사 → 전체 테스트 → 번들 빌드
npm run verify:coverage  # 같은 순서 + 기존 커버리지 임계값 검증 (CI 공통)
```

한 단계가 실패해도 다음 단계를 실행해 오류를 한 번에 모읍니다. 하나라도 실패하면 명령의
종료 코드가 0이 아니며, 중단하면 실행 중인 자식 프로세스를 종료하고 나머지를 건너뜁니다.
타입 검사는 main·renderer·tests 세 설정을 모두 확인합니다. 번들 단계는 타입 검사를
반복하지 않습니다. 단독 `npm run build`는 타입 검사도 실행합니다.
자식 프로세스 출력은 파일에 직접 기록하고 콘솔로 중계합니다. 실행 파일 누락이나
동기 `spawn` 예외도 해당 단계의 실패로 기록한 뒤 나머지 검사를 계속합니다.

콘솔에 실시간 출력과 단계별 소요 시간·종료 코드를 표시하며 다음 결과를 남깁니다.

- `.reports/verify/latest.json`: 전체 상태, 시작·종료 시간, 각 단계의 명령·상태·로그 경로
- `.reports/verify/incomplete.json`: 실행 중이거나 보고서 저장이 완료되지 않았음을 나타내는 표시
- `.reports/verify/*.log`: 각 단계의 stdout과 stderr
- `coverage/`: `verify:coverage`의 커버리지 결과

새 검증 시작 시 JSON 상태를 `running`으로 바꿔 이전의 성공을 현재 결과로 오판하지 않도록
합니다. 종료 코드와 함께 `status`, `startedAt`, `finishedAt`을 확인하세요. `incomplete.json`이
있거나 강제 종료로 `running`이 남으면 완료된 검증이 아닙니다. Windows의 일시적 파일 잠금은
제한된 횟수만 재시도하며, 저장에 실패하면 성공으로 처리하지 않습니다.
한 체크아웃에서는 전체 검증을 한 번에 하나만 실행합니다. 결과 파일은 Git에서 제외됩니다.
CI와 릴리스 검증은 같은 `verify:coverage`를 사용하며 실패 시에도 로그와 커버리지를
artifact로 보존합니다. CI는 Ubuntu와 Windows에서 실행됩니다.

문서만 수정했다면 링크·참조·diff·서식 확인으로 마칠 수 있습니다. 화면이나 네이티브 기능의
동작을 바꿨다면 자동 검사 외에 관련 UI/실행 확인이 필요합니다. 이 검증 명령은 실제 ComfyUI
서버에 이미지를 생성하거나 Windows 설치 패키지를 검증하지 않습니다.

## 격리된 Electron 앱 검사

```bash
npm run smoke                         # 새 격리 빌드 → 앱 검사 → 재시작 → 정리
npm run smoke -- --inject-failure      # 의도한 assertion 실패: exit 1과 실패 단계 확인
```

Node·Electron 설치와 GUI/자식 프로세스 실행 권한이 필요합니다. 추가 브라우저 설치나
ComfyUI/GPU는 필요하지 않습니다. 기존 `FakeComfyUIServer`를 loopback의 임의 포트로 띄우고,
실제 main·preload·renderer·IPC·sql.js를 사용합니다. UI의 라이브러리 모듈·아이템 생성,
프롬프트 조회, 잘못된 IPC 입력 거부, 연결 해제·재연결, 정상 종료 후 DB 저장과 재시작 시
표시를 검사하도록 구성되어 있습니다. 입력은 renderer DOM 이벤트이며 OS 입력·파일 선택기·
네이티브 PTY·실제 이미지 생성은 이 검사의 범위에 포함하지 않습니다.

실행마다 `.reports/smoke/run-*/`에 `result.json`, 단계별 로그, Electron 단계 JSON과 화면 PNG를
남깁니다. 보고서의 `inputSha256`은 빌드 입력을 식별하며 빌드 중 입력이 바뀌면 실패합니다.
숨긴 검사 창에서도 렌더링을 유지하고 DOM 변경 이후의 프레임을 기다려 화면을 캡처합니다.
캡처는 프레임 대기를 포함해 3초로 제한하며, 실패 진단용 캡처가 막혀도 원래 오류를
즉시 기록하고 정상 종료를 시도합니다. 추가 캡처 오류는 `screenshotError`에 분리합니다.
빌드·DB·Chromium 프로필은 그 실행의 `runtime/`에만 생성하고 종료 후 제거합니다.
서로 다른 실행/작업 트리가 프로필·포트·번들을 공유하지 않습니다. `npm run dev`와
`npm start`는 기존 사용자 프로필을 사용하므로 격리 검사를 대신하지 않습니다.

중단은 `Ctrl+C`이며 단계 제한 시간은 기본 45초(빌드 120초)입니다. 프로세스 트리 종료나
폴더 제거를 확인하지 못하면 `cleanup: failed`와 해당 PID/오류를 남기고 성공 처리하지
않습니다. 강제 종료로 `running`이 남은 보고서도 완료 증거가 아닙니다. `--inject-failure`는
`create.json`의 `injected-assertion` 실패까지 확인해야 하며, 준비/빌드 실패를 주입 성공으로
해석하면 안 됩니다.

제한된 Windows 환경에서 esbuild `spawn EPERM` 또는 Electron의
`platform_channel.cc` 접근 거부가 발생하면 앱 검사는 실행되지 않은 것입니다.
보안 플래그를 끄지 말고 로그로 환경 오류와 코드 실패를 구분하세요. 기존 번들의 시작만
진단하려면 `npm run smoke -- --existing-build`를 사용합니다. 이 모드는 검사가 모두 끝나도
`status: limited`, **exit 2**이며 현재 소스 빌드의 성공으로 간주하지 않습니다.

2026-09-05 Windows x64 데스크톱에서 명령별 승인 실행으로 `doctor`, `verify:coverage`,
`smoke`를 확인했습니다. 실제 Electron의 정상 생성·재연결·재시작 검사는 exit 0,
`smoke -- --inject-failure`는 지정한 assertion에서 exit 1이며 양쪽 모두 정상 종료와
임시 폴더 정리를 확인했습니다. Linux GUI는 확인하지 않았으며 CI의 필수 게이트는
현재 `verify:coverage`입니다.

## 코드와 검증 위치

| 변경 영역            | 구현 진입점                                                | 우선 확인할 테스트                                                                                       |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 배치 생성·draft 편집 | `src/main/services/batch/batch-job-service.ts`             | `tests/main/services/batch/batch-job-service.test.ts`, `tests/main/services/mcp/workflows-batch.test.ts` |
| 실행·복구·완료 저장  | `src/main/services/batch/queue-manager.ts`                 | `queue-faults`, `output-journal`, `output-crash` (`tests/main/services/batch/`)                          |
| DB 영속화·조회       | `src/main/services/database/`                              | `tests/main/services/database/`                                                                          |
| IPC 계약·입력 검증   | `src/shared/ipc-contract.ts`, `src/main/ipc/validators.ts` | `tests/main/ipc/`, `tests/shared/ipc-channels.test.ts`                                                   |
| 파일 접근            | `src/main/services/assets/local-asset.ts`                  | `tests/main/services/assets/local-asset.test.ts`                                                         |
| 화면·상태            | `src/renderer/src/views/`, `src/renderer/src/stores/`      | `tests/renderer/`                                                                                        |
| 개발 도구·릴리스     | `scripts/`                                                 | `tests/tooling/`, `tests/release/`                                                                       |

배치 실패·강제 종료 테스트는 `tests/helpers/fake-comfyui.ts`와 임시 DB·출력 폴더를 사용합니다.
기존 helper를 재사용하고 개인 ComfyUI 서버나 실제 사용자 DB를 테스트 대상으로 삼지 않습니다.
세부 계약은 해당 소스·테스트를 읽고, 과거 감사 기록을 현재 상태의 증거로 대체하지 않습니다.
