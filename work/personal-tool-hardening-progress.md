# Personal tool hardening — historical record

> 2026-08-02 작업의 회고 기록이에요. 아래 범위·결정·검증 결과는 당시 상태이며 현재 작업 지침이나 승인 조건이 아니에요. 현재 동작과 검증 상태는 코드와 새 실행 결과로 확인해요.

Updated: 2026-08-02 KST

## Goal

- Implement the approved personal-tool-focused fixes in order: queue retry correctness, effective settings, safe draft editing, output containment, shared IPC/MCP batch creation, and result consistency.

## Scope

- In scope: batch queue state transitions, batch settings wiring, draft update IPC, safe output paths, shared batch creation service, MCP non-blocking start, partial result cleanup, gallery removal wording, focused regression tests, required project docs.
- Out of scope: full application-service architecture, broad repository/IPC file splitting, full migration framework, preload redesign, dead schema/channel cleanup, physical gallery-file deletion, live ComfyUI E2E, commit/push/release.

## Recorded outcome

- Done: codebase audit; phases 1-5, including queue/settings fixes, draft-only editing, output containment, shared lazy IPC/MCP creation, non-blocking starts, zero-output failures, atomic gallery persistence, partial-file cleanup, and gallery removal wording.

## Decisions

- Keep the design incremental: extract only the shared batch-creation use case that already differs between IPC and MCP.
- Treat `max_retries` as the canonical key and retain legacy reads only where compatibility is useful.
- Restrict in-place editing to draft jobs; completed or executed jobs remain clone-only.
- Keep gallery deletion DB-only and align the UI wording to “remove from gallery”.
- 당시 미추적 계획 파일은 보존했어요. 해당 계획의 후속 보관 위치는 [2026-07 하드닝 회고](../docs/history/2026-07-hardening.md)예요.

## Files and areas

- Read: queue manager, repositories, batch generator/wizard, settings, IPC contracts/handlers, MCP batch tools, current tests and docs.
- Changed: queue manager; batch repositories and shared batch-job service; Settings store/view; BatchWizard and JobCard; shared IPC channels/contracts; IPC and MCP adapters; output path resolver and validators; focused repository/queue/handler/component/path/MCP tests; this progress note.

## Validation

- Run: all focused suites passed; full Vitest passed (47 files, 511 tests); coverage gates passed; lint passed with two non-blocking `vue/one-component-per-file` warnings in the existing combined jobs component test; node/web typecheck and full Electron build passed; v1.0.1 release metadata and `git diff --check` passed.
- Not run: live ComfyUI E2E, commit, push, release (all intentionally out of scope).
- Known existing failures: none.

## 당시 미검증 범위

- 실제 ComfyUI를 연결한 수동 확인과 릴리스는 수행하지 않았어요. 이 기록은 다음 작업이나 버전 변경을 요구하지 않아요.
