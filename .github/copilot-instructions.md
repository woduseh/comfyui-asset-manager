# Copilot Instructions — ComfyUI Asset Manager

## Build & Dev Commands

```bash
npm run dev              # Launch Electron app in dev mode (HMR for renderer)
npm run build            # Typecheck + build all (main, preload, renderer)
npx electron-vite build  # Build only (skip typecheck, faster iteration)
npm run lint             # ESLint (flat config, Vue + TS + Prettier)
npm run format           # Prettier format all files
npm run typecheck        # Run both node and web typechecks
npm run typecheck:node   # Typecheck main process + preload only
npm run typecheck:web    # Typecheck renderer (Vue) only
```

No test framework is configured. Build verification: `npx electron-vite build` must succeed.

## Architecture

This is a **three-process Electron app** built with electron-vite:

```
src/main/         → Electron main process (Node.js)
src/preload/      → Preload script (context bridge)
src/renderer/src/ → Vue 3 SPA (browser context)
```

### IPC Communication Pattern

**Renderer → Main** (request-response):
- Main registers handlers via `ipcMain.handle(channel, handler)` in `src/main/ipc/handlers.ts`
- Renderer calls `window.electron.ipcRenderer.invoke(channel, args)` from Pinia stores
- All channel names are constants in `src/main/ipc/channels.ts`

**Main → Renderer** (events):
- Main sends via `win.webContents.send(channel, data)`
- Renderer listens via `window.electron.ipcRenderer.on(channel, handler)` in `App.vue`
- Event channels: `comfyui:connection-changed`, `queue:progress`, `queue:task-completed`, `queue:task-failed`, `queue:job-completed`, `comfyui:preview`

### Database (sql.js)

In-memory SQLite via `sql.js` (WASM). No native bindings — chosen because `better-sqlite3` fails on Node 24 without VS Build Tools.

- **Init**: `src/main/services/database/index.ts` — loads from `{userData}/data/comfyui_asset_manager.db`
- **Persistence**: Debounced writes (1s). `saveDatabase()` after every mutation, `saveDatabaseSync()` on quit.
- **Schema**: 12 tables with foreign keys + CASCADE deletes. Schema defined inline in `createTables()`.
- **Data access**: Repository classes in `src/main/services/database/repositories/index.ts`. All follow `list/get/create/update/delete` pattern. Every mutation must call `saveDatabase()`.

### ComfyUI Integration

Singleton `comfyuiManager` in `src/main/services/comfyui/manager.ts` coordinates:
- **REST client** (`client.ts`): Uses `ofetch`. Endpoints: `/prompt`, `/queue`, `/history/{id}`, `/system_stats`, `/object_info`, `/view`, `/upload/image`.
- **WebSocket** (`websocket.ts`): Uses `ws` package (Node.js, not browser). Auto-reconnects with exponential backoff (3s→30s). Emits typed events: `progress`, `executionComplete`, `executionError`, `preview`.
- **Workflow parser** (`workflow-parser.ts`): Extracts variables from ComfyUI API JSON. `VARIABLE_NODE_TYPES` in `types.ts` defines known node fields.

### Batch Execution Pipeline

```
BatchConfig → cartesianProduct() → GeneratedTask[] → QueueManager.processTask()
                                                         ↓
                                              injectPromptData() into workflow JSON
                                                         ↓
                                              comfyuiManager.restClient.queuePrompt()
                                                         ↓
                                              waitForCompletion() (polls /history)
                                                         ↓
                                              Download images → save to disk → DB record
```

- **Task generator** (`src/main/services/batch/task-generator.ts`): Cartesian product of module item selections × countPerCombination.
- **Queue manager** (`src/main/services/batch/queue-manager.ts`): Sequential execution. Supports pause/resume/cancel. Retries configurable via settings.

### Prompt Composition

`src/main/services/prompt/composition-engine.ts` assembles prompts in this order:
quality → style → artist → character → outfit → emotion → lora → negative → custom

- Weight format: `(text:1.20)` when weight ≠ 1.0
- Wildcards: `{red|blue|green}` resolved with deterministic LCG when seeded
- Variables: `{{variable_name}}` interpolated from a map
- `previewPrompt()` skips wildcard resolution for UI preview

## Key Conventions

### Path Aliases

| Alias | Resolves to | Used in |
|-------|-------------|---------|
| `@renderer/*` | `src/renderer/src/*` | Renderer process (tsconfig.web.json + electron.vite.config.ts) |
| `@main/*` | `src/main/*` | Main process (electron.vite.config.ts only) |

### Renderer Patterns

- **UI library**: Naive UI — import components individually (tree-shaking)
- **State management**: Pinia with **Composition API** (`defineStore(name, setupFn)`)
- **Router**: `vue-router` with hash history (`createWebHashHistory`) for Electron compatibility
- **i18n**: `vue-i18n` non-legacy mode. Korean default, English fallback. Keys: `src/renderer/src/locales/{ko,en}.json`
- **Stores communicate with main process** exclusively through `window.electron.ipcRenderer.invoke()` — never `require('electron')` directly

### Main Process Patterns

- **Singletons**: `comfyuiManager` (ComfyUI connection), `queueManager` (batch execution) — instantiated at module level via `export const`
- **Repository instantiation**: Created as module-level `const` in `handlers.ts`, not dependency-injected
- **All file I/O and Node.js APIs** live in main process only. Renderer accesses them through IPC.

### TypeScript

- Two separate tsconfig: `tsconfig.node.json` (main + preload) and `tsconfig.web.json` (renderer)
- ESLint enforces `<script lang="ts">` in all `.vue` files
- Shared types: `src/renderer/src/types/ipc.ts` (imported by renderer stores; main process uses `Record<string, unknown>` from sql.js)

### Module Types

The `ModuleType` union defines prompt module categories used throughout the codebase:
`'character' | 'outfit' | 'emotion' | 'style' | 'artist' | 'quality' | 'negative' | 'lora' | 'custom'`

### ComfyUI Workflow Format

This app works with **API format** JSON (node IDs as keys, `class_type` + `inputs`), not UI format (nodes + links arrays). The workflow parser detects format and rejects UI format with an error message.

### Release Documentation

Every feature/fix commit must update these 3 files together:
- **`AGENTS.md`** — AI agent conventions and project rules
- **`README.md`** — User-facing feature documentation
- **`CHANGELOG.md`** — Version history (Added/Changed/Fixed/Removed per SemVer section)

Bump `package.json` version using SemVer: MAJOR (breaking), MINOR (feature), PATCH (fix).
