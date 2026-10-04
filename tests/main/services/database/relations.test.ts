import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openTestDatabase } from '../../../helpers/database'
import {
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository,
  ModuleItemRepository,
  ModuleRepository
} from '@main/services/database/repositories'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
let fixture: Awaited<ReturnType<typeof openTestDatabase>>
beforeEach(async () => {
  fixture = await openTestDatabase((path) => {
    state.directory = path
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.close()
})

function createResults(): {
  jobs: BatchJobRepository
  tasks: BatchTaskRepository
  images: GeneratedImageRepository
  jobId: string
  taskId: string
  imageId: string
  file: string
} {
  const jobs = new BatchJobRepository()
  const tasks = new BatchTaskRepository()
  const images = new GeneratedImageRepository()
  const jobId = jobs.create({ name: 'Retained results', config: '{}' })
  const taskId = tasks.createSingle({
    job_id: jobId,
    prompt_data: '{}',
    sort_order: 0,
    metadata: '{}'
  })
  const file = join(fixture.directory, 'original.png')
  writeFileSync(file, 'original bytes')
  const imageId = images.create({
    job_id: jobId,
    task_id: taskId,
    file_path: file,
    prompt_text: 'retained prompt'
  })
  fixture.db.run('INSERT INTO saved_seeds (id, seed, source_task_id) VALUES (?, ?, ?)', [
    'seed',
    42,
    taskId
  ])
  return { jobs, tasks, images, jobId, taskId, imageId, file }
}

describe('saved database relation contracts', () => {
  it.each(['async', 'sync'] as const)(
    'preserves foreign keys after %s snapshots and reopening',
    async (mode) => {
      const modules = new ModuleRepository()
      const items = new ModuleItemRepository()
      const id = modules.create({ name: 'Parent', type: 'custom' })
      items.create({ module_id: id, name: 'Child', prompt: 'kept until parent deletion' })
      if (mode === 'async') await fixture.database.flushDatabase()
      else fixture.database.saveDatabaseSync()
      expect(fixture.db.exec('PRAGMA foreign_keys')[0].values).toEqual([[1]])
      modules.delete(id)
      expect(items.count(id)).toBe(0)
      expect(() => items.create({ module_id: id, name: 'Orphan', prompt: 'rejected' })).toThrow()
      await fixture.database.closeDatabase()
      fixture.db = await fixture.database.initDatabase()
      await fixture.database.flushDatabase()
      expect(fixture.db.exec('PRAGMA foreign_key_check')).toEqual([])
      expect(items.count(id)).toBe(0)
    }
  )

  it.each(['tasks', 'job'] as const)(
    'removes %s while preserving gallery, source files and saved seeds',
    async (target) => {
      const result = createResults()
      await fixture.database.flushDatabase()
      if (target === 'tasks') result.tasks.deleteByJob(result.jobId)
      else result.jobs.delete(result.jobId)
      expect(result.tasks.listByJob(result.jobId)).toEqual([])
      expect(result.images.get(result.imageId)).toMatchObject({
        task_id: null,
        job_id: target === 'job' ? null : result.jobId,
        prompt_text: 'retained prompt',
        file_path: result.file
      })
      expect(fixture.db.exec('SELECT seed, source_task_id FROM saved_seeds')[0].values).toEqual([
        [42, null]
      ])
      expect(readFileSync(result.file, 'utf8')).toBe('original bytes')
      await fixture.database.flushDatabase()
      await fixture.database.closeDatabase()
      fixture.db = await fixture.database.initDatabase()
      expect(result.images.get(result.imageId)).not.toBeNull()
      expect(fixture.db.exec('PRAGMA foreign_key_check')).toEqual([])
    }
  )

  it('rolls back detached references when task deletion fails', () => {
    const result = createResults()
    fixture.db.run(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON batch_tasks BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END"
    )
    expect(() => result.jobs.delete(result.jobId)).toThrow('injected delete failure')
    expect(result.images.get(result.imageId)).toMatchObject({
      task_id: result.taskId,
      job_id: result.jobId
    })
    expect(result.tasks.get(result.taskId)).not.toBeNull()
    expect(result.jobs.get(result.jobId)).not.toBeNull()
    expect(fixture.db.exec('PRAGMA foreign_key_check')).toEqual([])
  })

  it('copies disabled items and their prompt variants without silently enabling them', () => {
    const modules = new ModuleRepository()
    const items = new ModuleItemRepository()
    const sourceId = modules.create({ name: 'Source', type: 'character' })
    const id = items.create({
      module_id: sourceId,
      name: 'Disabled',
      prompt: 'p',
      weight: 0,
      prompt_variants: '{"alt":{"prompt":"alternate","negative":""}}'
    })
    items.update(id, { enabled: 0 })
    const copy = modules.duplicate(sourceId, 'Copy')!
    expect(items.list(copy.newModuleId)[0]).toMatchObject({
      enabled: 0,
      weight: 0,
      prompt_variants: items.get(id)!.prompt_variants
    })
  })
})

describe('job summaries and terminal counters', () => {
  it('commits task state and its counter once, preserving uncertainty and rollback', async () => {
    const { tasks, jobs, jobId, taskId } = createResults()
    expect(tasks.finish(taskId, 'completed')).toBe(true)
    expect(tasks.finish(taskId, 'completed')).toBe(false)
    expect(tasks.finish(taskId, 'failed')).toBe(false)
    expect(jobs.get(jobId)).toMatchObject({ completed_tasks: 1, failed_tasks: 0 })
    const failed = tasks.createSingle({
      job_id: jobId,
      prompt_data: '{}',
      sort_order: 1,
      metadata: '{}'
    })
    fixture.db.run(
      "CREATE TRIGGER reject_progress BEFORE UPDATE OF failed_tasks ON batch_jobs BEGIN SELECT RAISE(ABORT, 'counter failure'); END"
    )
    expect(() => tasks.finish(failed, 'failed')).toThrow('counter failure')
    expect(tasks.get(failed)?.status).toBe('pending')
    fixture.db.run('DROP TRIGGER reject_progress')
    tasks.updateStatus(failed, 'uncertain')
    expect(tasks.finish(failed, 'failed')).toBe(false)
    expect(jobs.get(jobId)).toMatchObject({ completed_tasks: 1, failed_tasks: 0 })
    await fixture.database.flushDatabase()
    await fixture.database.closeDatabase()
    fixture.db = await fixture.database.initDatabase()
    expect(jobs.get(jobId)?.completed_tasks).toBe(1)
    expect(tasks.get(failed)?.status).toBe('uncertain')
  })

  it('pages summaries without losing actionable or uncertain jobs or transporting snapshots', () => {
    const jobs = new BatchJobRepository()
    const tasks = new BatchTaskRepository()
    fixture.database.withTransaction(() => {
      for (let index = 0; index < 55; index++) {
        const id = jobs.create({
          name: `History ${index}`,
          config: 'large config',
          module_data_snapshot: 'large snapshot'
        })
        jobs.updateStatus(id, 'completed')
      }
    })
    const attention = jobs.create({
      name: 'Attention',
      config: '{}',
      module_data_snapshot: 'hidden'
    })
    jobs.updateStatus(attention, 'completed')
    const id = tasks.createSingle({
      job_id: attention,
      prompt_data: '{}',
      metadata: '{}',
      sort_order: 0
    })
    tasks.updateStatus(id, 'uncertain')
    const draft = jobs.create({ name: 'Draft', config: '{}' })
    const current = jobs.listSummaries(-1, 0, undefined, 'current')
    expect(current.items.map((row) => row.id).sort()).toEqual([attention, draft].sort())
    expect(current.items.find((row) => row.id === attention)?.uncertain_tasks).toBe(1)
    const first = jobs.listSummaries(50, 0, undefined, 'history')
    const next = jobs.listSummaries(50, 50, undefined, 'history')
    expect(first.total).toBe(55)
    expect(first.items).toHaveLength(50)
    expect(next.items).toHaveLength(5)
    expect(new Set([...first.items, ...next.items].map((row) => row.id)).size).toBe(55)
    for (const row of [...current.items, ...first.items, ...next.items]) {
      expect(row).not.toHaveProperty('config')
      expect(row).not.toHaveProperty('module_data_snapshot')
      expect(row).not.toHaveProperty('pipeline_config')
    }
    expect(jobs.get(attention)?.module_data_snapshot).toBe('hidden')
  })

  it('preserves legacy orphan rows for explicit review rather than silently deleting them', async () => {
    fixture.db.run('PRAGMA foreign_keys = OFF')
    fixture.db.run(
      "INSERT INTO module_items (id, module_id, name, prompt) VALUES ('legacy-orphan', 'missing', 'Retained', 'valuable content')"
    )
    fixture.database.saveDatabaseSync()
    await fixture.database.closeDatabase()
    fixture.db = await fixture.database.initDatabase()
    await fixture.database.flushDatabase()
    expect(fixture.db.exec('PRAGMA foreign_keys')[0].values).toEqual([[1]])
    expect(new ModuleItemRepository().get('legacy-orphan')?.prompt).toBe('valuable content')
    expect(fixture.db.exec('PRAGMA foreign_key_check')[0].values).toHaveLength(1)
  })
})

describe('execution identity migration', () => {
  it('adds nullable server identities and pending indexes without inventing an origin for legacy prompts', async () => {
    const jobs = new BatchJobRepository(),
      tasks = new BatchTaskRepository()
    const id = jobs.create({ name: 'Legacy', config: '{}' })
    const task = tasks.createSingle({
      job_id: id,
      prompt_data: '{}',
      metadata: '{}',
      sort_order: 1
    })
    // An older database can contain an accepted request without its server address.
    fixture.db.run('UPDATE batch_tasks SET comfyui_prompt_id = ? WHERE id = ?', [
      'legacy-prompt',
      task
    ])
    fixture.db.run('ALTER TABLE batch_tasks DROP COLUMN comfyui_server_url')
    fixture.db.run('DROP INDEX idx_batch_tasks_pending')
    await fixture.database.closeDatabase()
    fixture.db = await fixture.database.initDatabase()
    expect(tasks.get(task)).toMatchObject({
      comfyui_prompt_id: 'legacy-prompt',
      comfyui_server_url: null
    })
    const prepare = vi.spyOn(fixture.db, 'prepare')
    expect(tasks.listByJobPending(id, 10)).toHaveLength(1)
    const sql = prepare.mock.calls[0][0]
    expect(
      fixture.db
        .exec(`EXPLAIN QUERY PLAN ${sql}`, [id, 10])[0]
        .values.map((row) => row[3])
        .join(' ')
    ).toContain('idx_batch_tasks_pending')
    expect(tasks.pendingServerConflict(id, 'http://localhost:8188')).toEqual({ serverUrl: null })
  })
})
