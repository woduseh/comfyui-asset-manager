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

## 전체 검증과 실패 분석

```bash
npm run verify           # lint → 타입 검사 → 전체 테스트 → 번들 빌드
npm run verify:coverage  # 같은 순서 + 기존 커버리지 임계값 검증 (CI 공통)
```

한 단계가 실패해도 다음 단계를 실행해 오류를 한 번에 모읍니다. 하나라도 실패하면 명령의
종료 코드가 0이 아니며, 중단하면 실행 중인 자식 프로세스를 종료하고 나머지를 건너뜁니다.
타입 검사는 main·renderer·tests 세 설정을 모두 확인합니다. 번들 단계는 타입 검사를
반복하지 않습니다. 단독 `npm run build`는 타입 검사도 실행합니다.

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
