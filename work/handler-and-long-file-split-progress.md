# Handler hardening and long-file split — historical record

> 2026-08-02 작업의 회고 기록이에요. 아래 범위·결정·검증 결과는 당시 상태이며 현재 작업 지침이나 승인 조건이 아니에요. 현재 동작과 검증 상태는 코드와 새 실행 결과로 확인해요.

Updated: 2026-08-02 KST

## Goal

- Fix destructive batch rerun preflight and split the remaining 800+ line production files along existing domain/UI boundaries without changing public behavior.

## Scope

- In scope: rerun preflight + transaction, IPC handler registration split, QueueManager execution helper extraction, GalleryView/ModuleView child-component and pure-helper extraction, focused tests, required README/CHANGELOG/AGENTS updates.
- Out of scope: new product features, schema changes, physical gallery file deletion, dependency changes, live ComfyUI E2E, commit/push/release.

## Recorded outcome

- Done: prior personal-tool hardening phases; long-file boundary mapping; rerun fix; IPC batch registration split; QueueManager prompt/output split; Gallery filter/card and Module filter/browser split.

## Decisions

- Treat 800+ production source lines as the review threshold, but split only at cohesive existing boundaries.
- Preserve public import paths through re-exports where repository modules move.
- Keep file-split commits conceptually behavior-neutral; add tests only for the rerun behavior and newly exposed pure seams.
- Preserve all existing user and prior-task worktree changes.
- Keep the repository collection intact for now — its classes are sequential and independently cohesive; splitting it would create broad import churn without reducing an active mixed-responsibility hotspot.

## Files and areas

- Read: existing plans and completed hardening progress.
- Changed: QueueManager preflight/prompt/output modules; batch IPC registration module; Gallery/Module child components and gallery utility; focused handler/queue/pure utility tests; this progress note.

## Validation

- Run: focused suites passed; full Vitest passed (49 files, 516 tests); coverage gates passed; lint passed with the two existing non-blocking multi-component test warnings; node/web typecheck and full Electron build passed; v1.0.1 release metadata and `git diff --check` passed.
- Not run: live ComfyUI/UI E2E, commit, push, release (intentionally out of scope).
- Known existing failures: none; lint has two non-blocking multi-component test warnings.

## 당시 미검증 범위

- 실행 중인 앱에서 Gallery 필터·카드 선택과 Module 필터·브라우저 선택의 수동 확인은 수행하지 않았어요. 후속 작업을 자동으로 요구하지 않아요.
