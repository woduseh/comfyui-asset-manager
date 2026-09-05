import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, promises as fs, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import initSqlJs from 'sql.js'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

let database: typeof import('@main/services/database')
let tasks: InstanceType<typeof import('@main/services/database/repositories').BatchTaskRepository>

beforeEach(async () => {
  vi.resetModules()
  state.directory = mkdtempSync(join(tmpdir(), 'comfyui-db-performance-test-'))
  database = await import('@main/services/database')
  await database.initDatabase()
  const { BatchTaskRepository } = await import('@main/services/database/repositories')
  tasks = new BatchTaskRepository()
  database
    .getDatabase()
    .run("INSERT INTO batch_jobs (id, name, config) VALUES ('job', 'Job', '{}')")
  await database.flushDatabase()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.closeDatabase()
  const directory = resolve(state.directory)
  const inside = relative(resolve(tmpdir()), directory)
  if (
    !inside ||
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside) ||
    !basename(directory).startsWith('comfyui-db-performance-test-')
  ) {
    throw new Error(`Refusing to remove non-test directory: ${directory}`)
  }
  rmSync(directory, { recursive: true, force: true })
})

describe('completed prompt cleanup', () => {
  it('cleans only retained completed prompts and tracks later completions without losing evidence', () => {
    const db = database.getDatabase()
    db.run("INSERT INTO batch_jobs (id, name, config) VALUES ('other', 'Other', '{}')")
    const statuses = [
      'completed',
      'pending',
      'retrying',
      'running',
      'submitting',
      'uncertain',
      'failed',
      'cancelled'
    ]
    for (const [index, status] of statuses.entries()) {
      db.run(
        `INSERT INTO batch_tasks
         (id, job_id, status, prompt_data, comfyui_prompt_id, result_path, metadata, retry_count, sort_order)
         VALUES (?, 'job', ?, ?, ?, ?, ?, 2, ?)`,
        [
          status,
          status,
          '{"positive":"keep"}',
          `remote-${status}`,
          `/output/${status}.png`,
          '{"seed":42}',
          index
        ]
      )
    }
    for (const [id, jobId, prompt] of [
      ['already-cleared', 'job', '{}'],
      ['legacy-empty', 'job', ''],
      ['legacy-whitespace', 'job', ' { } '],
      ['other-job', 'other', '{"positive":"other"}']
    ]) {
      db.run(
        "INSERT INTO batch_tasks (id, job_id, status, prompt_data) VALUES (?, ?, 'completed', ?)",
        [id, jobId, prompt]
      )
    }
    const allRows = (): unknown => db.exec('SELECT * FROM batch_tasks ORDER BY id')
    const before = allRows()
    expect(() =>
      database.withTransaction(() => {
        tasks.clearPromptDataForCompleted('job')
        throw new Error('rollback cleanup')
      })
    ).toThrow('rollback cleanup')
    expect(allRows()).toEqual(before)

    const expected = [...tasks.listByJob('job'), ...tasks.listByJob('other')].map((task) => ({
      ...task,
      prompt_data: task.job_id === 'job' && task.status === 'completed' ? '{}' : task.prompt_data
    }))
    const run = vi.spyOn(db, 'run')
    tasks.clearPromptDataForCompleted('job')
    expect(db.getRowsModified()).toBe(3)
    const sql = String(run.mock.calls[0][0])
    run.mockRestore()
    expect([...tasks.listByJob('job'), ...tasks.listByJob('other')]).toEqual(expected)
    const plan = db.exec(`EXPLAIN QUERY PLAN ${sql}`, ['job'])[0].values
    expect(plan.map((row) => String(row[3])).join('\n')).toContain('idx_batch_tasks_prompt_cleanup')

    tasks.clearPromptDataForCompleted('job')
    expect(db.getRowsModified()).toBe(0)
    tasks.updateStatus('pending', 'completed')
    tasks.clearPromptDataForCompleted('job')
    expect(db.getRowsModified()).toBe(1)
    expect(tasks.get('pending')).toMatchObject({
      prompt_data: '{}',
      comfyui_prompt_id: 'remote-pending'
    })
    expect(tasks.get('uncertain')?.prompt_data).toBe('{"positive":"keep"}')
  })

  it('adds the partial index to a persisted legacy DB without clearing any prompts on startup', async () => {
    const db = database.getDatabase()
    const id = tasks.createSingle({
      job_id: 'job',
      prompt_data: '{"legacy":true}',
      sort_order: 0,
      metadata: '{}'
    })
    tasks.updateStatus(id, 'completed')
    db.run('DROP INDEX idx_batch_tasks_prompt_cleanup')
    const before = tasks.get(id)
    await database.closeDatabase()
    const reopened = await database.initDatabase()
    expect(tasks.get(id)).toEqual(before)
    expect(reopened.exec('PRAGMA index_list(batch_tasks)')[0].values).toEqual(
      expect.arrayContaining([expect.arrayContaining(['idx_batch_tasks_prompt_cleanup'])])
    )
    tasks.clearPromptDataForCompleted('job')
    await database.flushDatabase()
    await database.closeDatabase()
    await database.initDatabase()
    expect(tasks.get(id)).toEqual({ ...before, prompt_data: '{}' })
  })
})

describe('owned snapshot bytes', () => {
  it.each(['async', 'sync'] as const)(
    'persists only the exported byte range through the %s writer',
    async (mode) => {
      const db = database.getDatabase()
      const snapshot = db.export()
      const padded = new Uint8Array(snapshot.byteLength + 20).fill(0xff)
      padded.set(snapshot, 13)
      vi.spyOn(db, 'export').mockReturnValueOnce(padded.subarray(13, 13 + snapshot.byteLength))
      if (mode === 'async') {
        database.saveDatabase()
        await database.flushDatabase()
      } else {
        database.saveDatabaseSync()
      }
      expect(readFileSync(join(state.directory, 'data', 'comfyui_asset_manager.db'))).toEqual(
        Buffer.from(snapshot)
      )
    }
  )

  it('keeps the first export immutable while the DB changes before its asynchronous write', async () => {
    const db = database.getDatabase()
    const SQL = await initSqlJs()
    const originalOpen = fs.open.bind(fs)
    const originalRename = fs.rename.bind(fs)
    let release!: () => void
    let notify!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const started = new Promise<void>((resolveStarted) => {
      notify = resolveStarted
    })
    const persistedNames: unknown[] = []
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      notify()
      await gate
      return originalOpen(...args)
    })
    vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
      await originalRename(...args)
      const persisted = new SQL.Database(
        readFileSync(join(state.directory, 'data', 'comfyui_asset_manager.db'))
      )
      try {
        persistedNames.push(persisted.exec('SELECT name FROM batch_jobs')[0].values)
      } finally {
        persisted.close()
      }
    })

    db.run("UPDATE batch_jobs SET name = 'first'")
    database.saveDatabase()
    const flushing = database.flushDatabase()
    await started
    db.run("UPDATE batch_jobs SET name = 'second'")
    database.saveDatabase()
    release()
    await flushing
    expect(persistedNames).toEqual([[['first']], [['second']]])
    expect(db.exec('SELECT name FROM batch_jobs')[0].values).toEqual([['second']])
  })
})
