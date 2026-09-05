# Production redesign — historical record

> 2026-08-12 작업의 회고 기록이에요. 아래 범위·결정·검증 결과는 당시 상태이며 현재 작업 지침이나 승인 조건이 아니에요. 현재 동작과 검증 상태는 코드와 새 실행 결과로 확인해요.

Updated: 2026-08-12 KST

## Goal

- Implement the selected Production Queue concept as the app's default operational workspace.

## Scope

- In scope: global shell styling, default route, jobs/production layout, active run, queued jobs, recent results, responsive states, i18n and focused tests.
- In scope: runtime audit follow-up for disconnected active runs, library discovery, gallery missing thumbnails, terminal initialization, and form accessibility labels.
- Out of scope: database or IPC contract changes, generated-image deletion, release/version changes, deployment.

## Recorded outcome

- Done: audited the running app; selected concept saved as `work/ui-audit-2026-08-12/selected-production-queue.png`.
- Done: mapped the concept to existing batch, queue, gallery, and connection stores.
- Done: replaced the jobs card grid with the Production workspace and made it the default route.
- Done: added active-run metrics/stages, queue tables, recent-results inspector, empty states, responsive layout, and Korean/English copy.
- Done: completed runtime capture and iterative design QA in `design-qa.md`.
- Done: addressed the pre-commit static review findings: queue reordering, small-screen action layout, isolated recent-result queries, retry-preserving thumbnails, selected-result deep linking, and progress-derived stage states.
- Done: implemented the 2026-08-12 runtime audit follow-up for connection interruption, library discovery, missing gallery assets, terminal initialization, and form accessibility.

## Decisions

- Reuse real batch and gallery data; do not create mock production data.
- Keep existing routes and actions, but make Jobs the default route and visually label it as Production.
- Preserve the existing batch wizard behavior behind the primary New Generation action.
- Keep Production recent results independent from Gallery's persisted page/filter state.
- Reuse `BATCH_REORDER` for explicit up/down queue controls instead of restoring drag-and-drop.
- Treat a persisted running job without a live ComfyUI connection as interrupted UI state; do not present it as healthy execution.
- Track thumbnail failures on the current gallery page and reuse selection-mode deletion instead of adding a new destructive IPC.
- Keep library search and sorting renderer-local because the module collection is already loaded in memory.

## Validation

- Passed after runtime-audit fixes: focused renderer tests (4 files / 18 tests), full Vitest suite (50 files / 525 tests), typecheck, lint (0 errors / 2 existing non-blocking warnings), and Electron production build.

## 당시 미검증 범위

- 실제 ComfyUI 서버에서 중단된 작업의 재연결 복구는 수동 검증하지 않았어요. 후속 작업을 자동으로 요구하지 않아요.
