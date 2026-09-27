# Node 26 and test-performance upgrade — 2026-09-27

Target branch: maintenance/node26-test-performance-20260927

## Runtime and dependency policy

- Node.js is pinned to 26.10.0 through .node-version and package engines.
- Direct runtime and development dependencies were upgraded to the newest versions that satisfy their peer contracts.
- Vite remains on 7.3.6 because electron-vite 5.0.0 declares support for Vite 5, 6 and 7, not Vite 8.
- TypeScript remains on 6.0.3 because the current typescript-eslint 8.70.1 peer range is below TypeScript 6.1; TypeScript 7 is therefore not forced.
- Electron moved to 44.4.5. Gallery image clipboard writes use its W3C ClipboardItem API.
- TypeScript 6 migration removes baseUrl and uses explicit relative path mappings.
- Clean npm ci rebuilt node-pty for Electron 44.4.5. npm audit reported zero vulnerabilities.

## Test scheduling

Vitest already parallelizes test files. The repository keeps the forks pool and chooses workers from availableParallelism:

- 1 CPU -> 1 worker
- 2 CPUs -> 2 workers
- more than 2 CPUs -> one CPU remains free for the OS/build work

Tests inside a file stay sequential by default. Shared IPC mocks, Pinia state, fake timers and temporary database fixtures make blanket test.concurrent conversion unsafe.

An experiment split the slow BatchWizard cancellation matrix into another file. On the same two-core environment this duplicated Vue/Naive UI import and mount work and made the full suite slower, so the split was reverted.

## Measured wall-clock results

Same Oracle Linux arm64 workspace, two available CPUs, regular Vitest run without coverage:

| Configuration                                   | Wall clock |
| ----------------------------------------------- | ---------: |
| Node 24.14 / Vitest 4 original default          |   116.52 s |
| Node 24.14 / Vitest 4 explicit two forks        |    73.88 s |
| Node 26.10 / Vitest 5 one worker                |    95.04 s |
| Node 26.10 / Vitest 5 adaptive parallel workers |    67.25 s |

The final parallel configuration is about 29.2% faster than the same upgraded stack with one worker, 42.3% faster than the original default run, and 9.0% faster than the earlier explicitly tuned two-fork run.

The slow BatchWizard component suite is still the largest individual file. A simple file split was not beneficial; future improvements should reduce mount/import/setup cost or extract pure state transitions before adding more concurrency.

## Verification

- clean npm ci: passed
- doctor on Node 26.10.0: passed
- npm audit: zero vulnerabilities
- 87 test files / 888 tests: passed
- coverage gate: passed
- lint: passed
- main, renderer and test type checks: passed
- production Electron Vite bundle: passed
- Linux arm64 Electron 44 unpacked package inventory: passed
- required runtime assets, sql.js WASM and node-pty native files: present
- unexpected docs/tests/coverage/report files in packaged app: none

The package inventory is not a Windows installer run or a native GUI/PTTY smoke test. Windows CI remains the authoritative native packaging/runtime check after the branch is pushed.
