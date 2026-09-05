# Production redesign design QA — 2026-08 historical record

> 2026-08 프로덕션 리디자인 당시의 캡처·비교·검증 기록이에요. 아래 통과 판정, 테스트 수, 코드·화면 상태는 현재 결과가 아니에요. 시각 기준과 후속 제안은 당시 작업에 한정되며 현재 작업 범위나 승인 조건을 정하지 않아요.

## Comparison target

- Source visual truth: `C:\Users\wodus\ai-workspace\comfyui_asset_manager\work\ui-audit-2026-08-12\selected-production-queue.png`
- Final rendered implementation (real empty state): `C:\Users\wodus\ai-workspace\comfyui_asset_manager\work\ui-audit-2026-08-12\production-implementation-final.jpg`
- Final rendered implementation (temporary active-run visual fixture, reverted after capture): `C:\Users\wodus\ai-workspace\comfyui_asset_manager\work\ui-audit-2026-08-12\production-active-final.jpg`
- Full-view active comparison: `C:\Users\wodus\ai-workspace\comfyui_asset_manager\work\ui-audit-2026-08-12\production-active-comparison-final.png`
- Focused active-run comparison: `C:\Users\wodus\ai-workspace\comfyui_asset_manager\work\ui-audit-2026-08-12\production-active-focus-final.png`
- Viewport: Electron window content capture, 1388 × 894 logical pixels, dark theme, Korean locale.
- Source pixels: 1586 × 992 at reported density 72 DPI.
- Implementation pixels: 1388 × 894 at reported density 144 DPI; captured screenshot maps 1:1 to the logical Electron window.
- Normalization: source was resized with contain to 1388 × 894; implementation was retained at 1388 × 894. Both were placed in one 2776 × 894 comparison canvas.
- State: final product screenshot uses the actual database-backed empty active-run state. A temporary renderer-only active fixture based on an existing completed job was used to verify the selected mock's active-run composition; it never changed the database and was removed immediately after capture.

## Findings

- No actionable P0/P1/P2 visual differences remain.
- The selected design's large regions are represented in the implementation: compact navigation, active run with progress and pipeline stages, queue table region, recent results inspector, collapsed history, service status, and primary New Generation action.
- The final empty state intentionally differs from the source's populated state because no real job was running and the stored gallery paths were no longer present on disk. The UI now removes failed thumbnails and presents one coherent results empty state instead of repeating broken-image cards.

## Fidelity surfaces reviewed at the time

- Fonts and typography: Segoe UI/Noto Sans KR system stack preserves the compact operational hierarchy. Section eyebrow, 28 px page title, 21 px run title, metric labels, and tabular numbers are distinct and legible. Long dynamic names truncate rather than wrapping into controls.
- Spacing and layout rhythm: the sidebar was reduced from 200 px to 168 px after the first comparison. The 1.55/0.82 workspace split, 20–24 px content padding, 9–12 px radii, restrained borders, and collapsed history preserve the source's dense desktop rhythm without clipping at 1388 × 894.
- Colors and visual tokens: navy/graphite surfaces, low-contrast dividers, blue primary action, mint success, and red destructive status follow the source palette. No gradients or decorative CSS art were added.
- Image quality and asset fidelity: production uses registered gallery assets only. The current stored paths were absent on disk, so broken thumbnails are filtered and the explicit empty state is shown. No fake or generated production imagery ships in the implementation.
- Copy and content: Korean copy is task-oriented and maps to existing product concepts. English parity is included. “프로덕션”, “생성 대기열”, “최근 결과”, and “새 생성” stand alone without referencing the design prompt.
- Icons and affordances: all visible controls use the existing Ionicons set or Naive UI controls; pause, resume, cancel, start, history, results, and navigation remain semantically labeled.
- Responsiveness and accessibility: production workspace collapses to one column below 1180 px; the queue table becomes a two-column mobile row below 760 px. Buttons remain native controls, progress is semantic, image buttons have labels, and visible focus is retained for result selection.

## Full-view comparison evidence

- Pass 1 comparison: `production-comparison-pass1.png` showed a wider-than-source sidebar and nine repeated broken thumbnails in the results panel.
- Fixes: reduced expanded/collapsed sidebar widths to 168/56 px; added failed-image reporting to the shared thumbnail and filtered unavailable gallery assets from Recent Results.
- Pass 2 comparison: `production-active-comparison-final.png` shows the corrected shell proportions and a single honest results empty state. Active-run hierarchy, progress, metrics, stages, queue region, and history match the selected production-queue composition.
- Post-review hardening: unavailable result assets are retried on every fresh isolated query and expose an explicit retry action when every candidate fails; queue rows gained compact up/down controls without changing the main layout.

## Focused region comparison evidence

- `production-active-focus-final.png` compares the source and implementation active-run regions in the same image. The implementation keeps equivalent hierarchy and actions while using existing job fields: title/status, completed/total, linear progress, four operational metrics, and five pipeline stages.
- The source includes GPU use and a precise ETA; these are not available in the current renderer contract. The implementation uses elapsed time and failure count rather than inventing telemetry. This is an intentional product constraint, not unresolved visual drift.

## Primary interactions tested

- Default launch opens Production.
- Primary “새 생성” opens the existing three-step Batch Wizard.
- Wizard Cancel closes the modal without mutating data.
- Existing unit tests cover start, pause, resume, cancel, rerun, edit, clone, and delete event wiring.
- No blocking error dialog appeared during Electron capture. The Windows capture harness does not expose the renderer console directly; typecheck, lint, 517 tests, and the Electron production build were used as runtime-error gates.

## Comparison history

1. Pass 1 — P2: sidebar consumed more horizontal space than the source. P2: unavailable gallery paths produced repeated broken-image cards and a broken inspector.
2. Fix — narrowed the sidebar and added graceful failed-asset removal with a coherent empty state.
3. Pass 2 — post-fix full-view and focused comparisons show no remaining actionable P0/P1/P2 issue. The active-run state was rendered with a temporary non-persistent visual fixture and the code was reverted afterward.
4. Pre-commit static review — fixed queue reordering, mobile action overlap, Gallery filter leakage, transient image retry, selected-result deep linking, and progress-derived pipeline states. These changes preserve the approved desktop composition.

## 당시 남은 검증 제안

- P3: 실제 ComfyUI 실행·썸네일·ETA/처리량으로 같은 화면을 다시 확인하는 방안이 제안됐어요. 이 기록에서는 해당 확인을 수행하지 않았으며 후속 작업을 자동으로 요구하지 않아요.

Recorded result at the time: passed
