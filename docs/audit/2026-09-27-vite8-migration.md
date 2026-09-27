# Vite 8 migration — 2026-09-27

Target branch: `maintenance/vite8-migration-20260927`

Baseline: `4acb7d4` (`main` at migration start)

## Goal

Replace the `electron-vite` wrapper with a Vite 8-compatible integration without changing the
runtime layout, Electron sandbox policy, packaging contract, or verification workflow.

## Build architecture

- Replaced `electron-vite 5.0.0` with `vite-plugin-electron 1.1.2`.
- Upgraded Vite from 7.3.6 to 8.3.1.
- Renderer is now a normal Vite root at `src/renderer` with an explicit `./` base so production `file://` loading keeps relative asset URLs.
- Main and preload are built by `vite-plugin-electron/simple`.
- Existing output locations are preserved:
  - `out/main/index.js`
  - `out/preload/index.js`
  - `out/renderer/index.html`
- Production dependencies are externalized with package/subpath-aware regular expressions.
- `@electron-toolkit/preload` remains bundled into preload so a sandboxed preload never depends
  on an external runtime `require()`.
- The Electron dev startup explicitly calls `startup(['.'])`. The plugin's default
  `--no-sandbox` argument is not used.
- The renderer dev URL moved from the electron-vite-specific
  `ELECTRON_RENDERER_URL` variable to `VITE_DEV_SERVER_URL`.
- The old `?asset` main-process import was removed. The window icon is resolved from the stable
  packaged `resources/icon.png` path.
- Config files use `.mts` so Vite 8's future native config loader does not need to reinterpret ESM
  syntax from CommonJS-configured `.ts` files.

## Tooling migration

- `npm run dev` -> `vite`
- `npm run build:bundle` -> `vite build`
- `npm start` -> `electron .` for an already built application.
- `verify.mjs`, doctor, smoke input fingerprints, and verification tests now use Vite directly.
- Doctor validates Vite 8's Oxc TypeScript transform instead of depending on Vite 7's transitive
  esbuild installation.
- The process-termination fixture and database benchmark now create their isolated worker bundles
  through Vite/Rolldown rather than importing a transitive esbuild package.
- Fresh smoke builds use `COMFYUI_ASSET_BUILD_DIR` so renderer, main, and preload all target the
  same isolated runtime directory.

## Direct migration evidence

A development-server probe ran Vite with Electron startup prevented. It confirmed:

- Vite 8.3.1 renderer server reachable on loopback.
- main watch build emitted `out/main/index.js`.
- preload watch build emitted `out/preload/index.js`.
- no `--no-sandbox` argument appeared in the startup path.

Observed initial probe timings in this two-core Oracle Linux arm64 workspace:

- renderer server ready: about 0.45 s
- preload development build: about 0.10 s
- main development build: about 0.18 s

The database benchmark smoke scenario also completed through the new Vite/Rolldown worker bundler.

## Bundle observations

Before this migration, the Node 26 / Vite 7 verification build reported approximately:

- main entry: 344.92 kB
- preload entry: 2.32 kB
- renderer main entry: 1,659.43 kB

The first Vite 8 production build reported approximately:

- main entry: 203.18 kB
- preload entry: 1.19 kB
- renderer main entry: 619.70 kB

Chunk topology changed substantially under Vite 8/Rolldown, so these entry-file figures are evidence
of bundle-layout improvement, not a claim of equivalent total transferred bytes or measured startup
latency. Package inventory and runtime smoke remain separate checks.

## Final verification

- Clean `npm ci`: passed, including Electron 44.4.5 `node-pty` native rebuild.
- `npm audit`: zero vulnerabilities.
- `npm outdated`: only TypeScript 7.0.2 remains intentionally blocked by the current typescript-eslint peer range.
- Full `verify:coverage`: passed in 84.35 s.
- 87 test files / 889 tests: passed.
- Included-scope coverage: statements 83.72%, branches 78.70%, functions 84.70%, lines 85.17%.
- QueueManager function coverage remained above its existing gate after adding an explicit background-failure containment regression.
- Linux arm64 Electron package inventory: passed.
- `app.asar`: 47,283,514 bytes versus 48,758,896 bytes in the pre-migration Node 26 package check, about 3.0% smaller.
- ASAR roots remain only `LICENSE`, `node_modules`, `out`, `package.json`, and `resources`.
- sql.js WASM, production dependencies, and unpacked `node-pty` native binaries remain present.
- Production preload contains no runtime `require('@electron-toolkit/preload')`; only Electron itself remains external.

## Native smoke limitation

The fresh smoke build and loopback ComfyUI fixture passed. Native Electron creation is blocked in this
Linux container because the host lacks `libglib-2.0.so.0`, the same environment limitation observed
before the Vite 8 migration. This failure occurs before application JavaScript executes and is not
treated as product evidence.

## Remaining dependency blocker

After the migration, `npm outdated` reports only TypeScript 7.0.2. TypeScript stays on 6.0.3 because
the current typescript-eslint peer range still excludes TypeScript 7. Vite itself is no longer held
back.
