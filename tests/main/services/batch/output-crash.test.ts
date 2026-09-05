import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { terminateChild, waitForChildExit } from '../../../helpers/child-process'
import { FakeComfyUIServer } from '../../../helpers/fake-comfyui'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))
vi.mock('electron', () => ({ app: { getPath: () => electronState.userDataPath } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

let child: ChildProcess | undefined
let directory = ''
let bundleDirectory = ''
let server: FakeComfyUIServer
let database: typeof import('@main/services/database') | undefined

function removeTestDirectory(path: string): void {
  const resolved = resolve(path)
  const inside = relative(resolve(tmpdir()), resolved)
  if (
    !inside ||
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside) ||
    !basename(resolved).startsWith('comfyui-output-crash-')
  ) {
    throw new Error(`Refusing to remove non-test directory: ${resolved}`)
  }
  rmSync(resolved, { recursive: true, force: true })
}

beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'comfyui-output-crash-bundle-'))
  const shim = resolve('tests/fixtures/output-crash-electron.ts')
  await build({
    entryPoints: ['tests/fixtures/output-crash-worker.ts'],
    outfile: join(bundleDirectory, 'worker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    alias: { electron: shim, 'electron-log/main': shim, '@shared': resolve('src/shared') }
  })
  server = await FakeComfyUIServer.start()
  server.images.set('first.png', Buffer.from('first image'))
  server.images.set('second.png', Buffer.from('second image'))
})

afterEach(async () => {
  await terminateChild(child)
  child = undefined
  await database?.closeDatabase()
  database = undefined
  if (directory) removeTestDirectory(directory)
  directory = ''
})

afterAll(async () => {
  await server?.close()
  if (bundleDirectory) removeTestDirectory(bundleDirectory)
})

describe('output persistence across actual process termination', () => {
  it.each([
    { boundary: 'first-file', code: 71, images: 1, committed: false },
    { boundary: 'all-files', code: 72, images: 2, committed: false },
    { boundary: 'db-before-flush', code: 73, images: 2, committed: false },
    { boundary: 'flush-before-discard', code: 74, images: 2, committed: true }
  ])(
    '$boundary preserves evidence and only exposes durable gallery records',
    async ({ boundary, code, images, committed }) => {
      directory = mkdtempSync(join(tmpdir(), 'comfyui-output-crash-run-'))
      child = spawn(
        process.execPath,
        [join(bundleDirectory, 'worker.cjs'), directory, String(server.port), boundary],
        {
          env: {
            ...process.env,
            CRASH_TEST_USER_DATA: directory,
            NODE_PATH: resolve('node_modules')
          },
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe']
        }
      )
      const result = await waitForChildExit(child, 10000)
      expect(result.code, result.stderr).toBe(code)

      vi.resetModules()
      electronState.userDataPath = directory
      database = await import('@main/services/database')
      const db = await database.initDatabase()
      expect(db.exec("SELECT status FROM batch_tasks WHERE id = 'task'")[0].values[0][0]).toBe(
        committed ? 'completed' : 'running'
      )
      expect(db.exec('SELECT COUNT(*) FROM generated_images')[0].values[0][0]).toBe(
        committed ? 2 : 0
      )
      const output = join(directory, 'output')
      const files = readdirSync(output)
      expect(files).toHaveLength(images)
      expect(files.map((file) => readFileSync(join(output, file), 'utf8')).sort()).toEqual(
        images === 1 ? ['first image'] : ['first image', 'second image']
      )
      const journals = await import('@main/services/batch/output-journal')
      const unresolved = journals.recoverTaskOutputJournals((entry) => {
        const status = db.exec('SELECT status FROM batch_tasks WHERE id = ?', [entry.taskId])[0]
          ?.values[0]?.[0]
        const paths =
          db
            .exec('SELECT file_path FROM generated_images WHERE task_id = ?', [entry.taskId])[0]
            ?.values.map((row) => row[0]) ?? []
        return status === 'completed' && entry.paths.every((path) => paths.includes(path))
      })
      expect(unresolved).toHaveLength(committed ? 0 : 1)
      if (!committed) expect(unresolved[0].paths).toHaveLength(images)
      expect(readdirSync(join(directory, 'data', 'task-output-journals'))).toHaveLength(
        committed ? 0 : 1
      )
      expect(readdirSync(output)).toEqual(files)
    },
    20000
  )
})
