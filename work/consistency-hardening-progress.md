# Consistency hardening — historical record

> 2026-07-29 작업의 회고 기록이에요. 아래 범위·결정·검증 결과는 당시 상태이며 현재 작업 지침이나 승인 조건이 아니에요. 현재 동작과 검증 상태는 코드와 새 실행 결과로 확인해요.

Updated: 2026-07-29 KST

## Goal

- Implement the approved v1.0.1 security, IPC validation, harness, documentation, and release-integrity improvements in order.

## Scope

- In scope: workflow import boundary, mutation IPC validation, focused regression coverage, internal documentation alignment, release version gate, v1.0.1 metadata.
- Out of scope: ComfyUI live E2E, publishing, commit/push/release, user-owned untracked planning documents.

## Recorded outcome

- Done: workflow import boundary; mutation IPC validation; handler/MCP/locale tests; QueueManager and renderer coverage inclusion; tracked documentation; v1.0.1 metadata and release verifier.

## Decisions

- Workflow import will keep arbitrary user-selected locations but selection and reading will remain in the main process.
- 당시 사용자 소유 미추적 계획 파일은 수정 범위에서 제외했어요. 해당 계획의 후속 보관 위치는 [2026-07 하드닝 회고](../docs/history/2026-07-hardening.md)예요.
- No new validation dependency will be added.

## Files and areas

- Read: IPC handlers/contracts, workflow store/view, validators, test and release configuration, and the project documentation available at the time. 당시 계획의 맥락은 [2026-07 하드닝 회고](../docs/history/2026-07-hardening.md)에 보관돼요.
- Changed: IPC/services/contracts/view, validators/constants, test/coverage/release harness, tracked documentation and v1.0.1 metadata, this progress note.

## Validation

- Run before edits: `npm test`, `npm run test:coverage`, `npm run lint`, `npm run build`.
- Run: focused workflow/IPC/MCP/locale/release tests; repeated node/web typecheck; release verifier for v1.0.1.
- Final: `npm run lint`, `npm run test:coverage` (44 files, 481 tests), `npm run build`, `npm run verify:release -- v1.0.1`, and `git diff --check` all passed.
- Known existing failures: none.

## 당시 미검증 범위

- 실제 ComfyUI를 연결한 E2E와 커밋·게시·릴리스는 수행하지 않았어요. 당시의 후속 검토·승인 메모는 현재 작업의 승인 요건이 아니에요.
