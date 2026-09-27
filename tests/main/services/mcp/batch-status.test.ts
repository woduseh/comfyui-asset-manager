import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestDatabase, type TestDatabase } from '../../../helpers/database'
import {
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository
} from '@main/services/database/repositories'
import { batchStatus } from '@main/services/mcp/tools/workflows-batch'

const state = vi.hoisted(() => ({
  directory: '',
  queue: { isProcessing: false, isPaused: false, currentJobId: null as string | null }
}))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/batch/queue-manager', () => ({ queueManager: state.queue }))
let fixture: TestDatabase
let jobId: string
let taskId: string
const jobs = new BatchJobRepository()
const tasks = new BatchTaskRepository()
beforeEach(async () => {
  Object.assign(state.queue, { isProcessing: false, isPaused: false, currentJobId: null })
  fixture = await openTestDatabase((path) => {
    state.directory = path
  })
  jobId = jobs.create({
    name: 'Observed job',
    config: 'large configuration',
    module_data_snapshot: 'large snapshot',
    total_tasks: 2
  })
  taskId = tasks.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.close()
})

describe('read-only batch status snapshots', () => {
  it('shares unchanged counts but recomputes live execution flags without caching large fields', () => {
    const count = vi.spyOn(BatchTaskRepository.prototype, 'countByJobStatus')
    const first = batchStatus(jobId)
    expect(first.counts).toEqual({ pending: 1 })
    expect(first.job).not.toHaveProperty('config')
    expect(first.job).not.toHaveProperty('module_data_snapshot')
    first.counts.pending = 999
    first.job.name = 'caller modified'
    for (let i = 0; i < 10; i++) expect(batchStatus(jobId).counts).toEqual({ pending: 1 })
    expect(batchStatus(jobId).job.name).toBe('Observed job')
    expect(count).toHaveBeenCalledTimes(1)
    Object.assign(state.queue, { isProcessing: true, currentJobId: jobId })
    expect(batchStatus(jobId).execution_active).toBe(true)
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('invalidates for raw SQL, repository mutations, transaction rollback, exports and reopen', async () => {
    const count = vi.spyOn(BatchTaskRepository.prototype, 'countByJobStatus')
    batchStatus(jobId)
    fixture.db.run("UPDATE batch_tasks SET status = 'running' WHERE id = ?", [taskId])
    expect(batchStatus(jobId).counts).toEqual({ running: 1 })
    expect(() =>
      fixture.database.withTransaction(() => {
        tasks.updateStatus(taskId, 'uncertain')
        expect(batchStatus(jobId).requires_review).toBe(true)
        throw new Error('rollback')
      })
    ).toThrow('rollback')
    expect(batchStatus(jobId).counts).toEqual({ running: 1 })
    tasks.finish(taskId, 'completed')
    expect(batchStatus(jobId).counts).toEqual({ completed: 1 })
    expect(batchStatus(jobId).job.completed_tasks).toBe(1)
    const beforeExport = count.mock.calls.length
    await fixture.database.flushDatabase()
    expect(batchStatus(jobId).counts).toEqual({ completed: 1 })
    expect(count).toHaveBeenCalledTimes(beforeExport + 1)
    await fixture.database.closeDatabase()
    fixture.db = await fixture.database.initDatabase()
    expect(batchStatus(jobId).counts).toEqual({ completed: 1 })
    jobs.delete(jobId)
    expect(() => batchStatus(jobId)).toThrow('not found')
  })

  it('uses the production recent-results path without a gallery count query', () => {
    const images = new GeneratedImageRepository()
    for (let i = 0; i < 12; i++) images.create({ job_id: jobId, file_path: `/synthetic/${i}.png` })
    const prepare = vi.spyOn(fixture.db, 'prepare')
    expect(images.recent(8, jobId)).toHaveLength(8)
    const sql = prepare.mock.calls.map(([query]) => query)
    expect(sql).toHaveLength(1)
    expect(sql[0]).not.toMatch(/COUNT/i)
    expect(
      fixture.db
        .exec(`EXPLAIN QUERY PLAN ${sql[0]}`, [jobId, 8])[0]
        .values.map((row) => row[3])
        .join(' ')
    ).toContain('idx_generated_images_job_created')
  })
})
