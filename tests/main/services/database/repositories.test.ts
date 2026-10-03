import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import type { Database as SqlJsDatabase } from 'sql.js'
import { openTestDatabase } from '../../../helpers/database'

let mockDb: SqlJsDatabase
let fixture: Awaited<ReturnType<typeof openTestDatabase>>
const state = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.path } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// Import after mocking
import {
  SettingsRepository,
  WorkflowRepository,
  ModuleRepository,
  ModuleItemRepository,
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository
} from '../../../../src/main/services/database/repositories/index'

describe('Database Repositories', () => {
  beforeEach(async () => {
    fixture = await openTestDatabase((path) => {
      state.path = path
    })
    mockDb = fixture.db
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fixture.close()
  })

  describe('SettingsRepository', () => {
    let repo: SettingsRepository

    beforeEach(() => {
      repo = new SettingsRepository()
    })

    it('gets a default setting', () => {
      expect(repo.get('comfyui_host')).toBe('localhost')
    })

    it('returns null for non-existent key', () => {
      expect(repo.get('nonexistent')).toBeNull()
    })

    it('sets and gets a setting', () => {
      repo.set('theme', 'dark')
      expect(repo.get('theme')).toBe('dark')
    })

    it('upserts existing setting', () => {
      repo.set('comfyui_host', '192.168.1.1')
      expect(repo.get('comfyui_host')).toBe('192.168.1.1')
    })

    it('gets all settings', () => {
      const all = repo.getAll()
      expect(all).toHaveProperty('comfyui_host', 'localhost')
      expect(all).toHaveProperty('comfyui_port', '8188')
    })

    it('does not expose private MCP tokens through getAll', () => {
      repo.set('mcp_auth_token', 'secret')

      expect(repo.get('mcp_auth_token')).toBe('secret')
      expect(repo.getAll()).not.toHaveProperty('mcp_auth_token')
    })

    it('deletes a setting', () => {
      repo.set('temp', 'value')
      expect(repo.get('temp')).toBe('value')
      repo.delete('temp')
      expect(repo.get('temp')).toBeNull()
    })
  })

  describe('WorkflowRepository', () => {
    let repo: WorkflowRepository

    beforeEach(() => {
      repo = new WorkflowRepository()
    })

    it('creates and retrieves a workflow', () => {
      const id = repo.create({
        name: 'Test Workflow',
        category: 'generation',
        api_json: '{"1":{"class_type":"KSampler","inputs":{}}}'
      })
      const wf = repo.get(id)
      expect(wf).not.toBeNull()
      expect(wf!.name).toBe('Test Workflow')
      expect(wf!.category).toBe('generation')
    })

    it('lists workflows', () => {
      repo.create({ name: 'WF1', category: 'generation', api_json: '{}' })
      repo.create({ name: 'WF2', category: 'upscale', api_json: '{}' })
      const all = repo.list()
      expect(all).toHaveLength(2)
    })

    it('lists workflows by category', () => {
      repo.create({ name: 'WF1', category: 'generation', api_json: '{}' })
      repo.create({ name: 'WF2', category: 'upscale', api_json: '{}' })
      const gen = repo.list('generation')
      expect(gen).toHaveLength(1)
      expect(gen[0].name).toBe('WF1')
    })

    it('updates a workflow', () => {
      const id = repo.create({ name: 'Old', category: 'generation', api_json: '{}' })
      repo.update(id, { name: 'New', category: 'upscale' })
      const wf = repo.get(id)
      expect(wf!.name).toBe('New')
      expect(wf!.category).toBe('upscale')
    })

    it('deletes a workflow', () => {
      const id = repo.create({ name: 'ToDelete', category: 'generation', api_json: '{}' })
      repo.delete(id)
      expect(repo.get(id)).toBeNull()
    })

    it('returns null for non-existent workflow', () => {
      expect(repo.get('nonexistent')).toBeNull()
    })

    it('manages workflow variables', () => {
      const id = repo.create({ name: 'WF', category: 'generation', api_json: '{}' })
      repo.setVariables(id, [
        { node_id: '5', field_name: 'seed', display_name: 'Seed', var_type: 'seed' },
        { node_id: '2', field_name: 'text', display_name: 'Prompt', var_type: 'text' }
      ])
      const vars = repo.getVariables(id)
      expect(vars).toHaveLength(2)
    })

    it('replaces variables on re-set', () => {
      const id = repo.create({ name: 'WF', category: 'generation', api_json: '{}' })
      repo.setVariables(id, [
        { node_id: '1', field_name: 'a', display_name: 'A', var_type: 'text' }
      ])
      repo.setVariables(id, [
        { node_id: '2', field_name: 'b', display_name: 'B', var_type: 'number' }
      ])
      const vars = repo.getVariables(id)
      expect(vars).toHaveLength(1)
      expect(vars[0].field_name).toBe('b')
    })
  })

  describe('ModuleRepository', () => {
    let repo: ModuleRepository

    beforeEach(() => {
      repo = new ModuleRepository()
    })

    it('creates and retrieves a module', () => {
      const id = repo.create({ name: 'Characters', type: 'character', description: 'Char list' })
      const mod = repo.get(id)
      expect(mod).not.toBeNull()
      expect(mod!.name).toBe('Characters')
      expect(mod!.type).toBe('character')
    })

    it('lists all modules', () => {
      repo.create({ name: 'M1', type: 'character' })
      repo.create({ name: 'M2', type: 'emotion' })
      expect(repo.list()).toHaveLength(2)
    })

    it('filters by type', () => {
      repo.create({ name: 'M1', type: 'character' })
      repo.create({ name: 'M2', type: 'emotion' })
      expect(repo.list('emotion')).toHaveLength(1)
    })

    it('updates a module', () => {
      const id = repo.create({ name: 'Old', type: 'character' })
      repo.update(id, { name: 'New' })
      expect(repo.get(id)!.name).toBe('New')
    })

    it('deletes a module', () => {
      const id = repo.create({ name: 'Del', type: 'character' })
      repo.delete(id)
      expect(repo.get(id)).toBeNull()
    })

    it('includes item_count in list results', () => {
      const itemRepo = new ModuleItemRepository()
      const id1 = repo.create({ name: 'WithItems', type: 'character' })
      const id2 = repo.create({ name: 'Empty', type: 'emotion' })
      itemRepo.create({ module_id: id1, name: 'A', prompt: 'a' })
      itemRepo.create({ module_id: id1, name: 'B', prompt: 'b' })

      const modules = repo.list()
      const withItems = modules.find((m) => m.id === id1)
      const empty = modules.find((m) => m.id === id2)
      expect(withItems!.item_count).toBe(2)
      expect(empty!.item_count).toBe(0)
    })
  })

  describe('ModuleItemRepository', () => {
    let moduleRepo: ModuleRepository
    let itemRepo: ModuleItemRepository
    let moduleId: string

    beforeEach(() => {
      moduleRepo = new ModuleRepository()
      itemRepo = new ModuleItemRepository()
      moduleId = moduleRepo.create({ name: 'Characters', type: 'character' })
    })

    it('creates and lists items', () => {
      itemRepo.create({ module_id: moduleId, name: 'Alice', prompt: '1girl, alice' })
      itemRepo.create({ module_id: moduleId, name: 'Bob', prompt: '1boy, bob' })
      const items = itemRepo.list(moduleId)
      expect(items).toHaveLength(2)
    })

    it('creates item with defaults', () => {
      const id = itemRepo.create({ module_id: moduleId, name: 'Test', prompt: 'prompt' })
      const items = itemRepo.list(moduleId)
      const item = items.find((i) => i.id === id)!
      expect(item.weight).toBe(1.0)
      expect(item.negative).toBe('')
      expect(item.enabled).toBe(1)
    })

    it('updates an item', () => {
      const id = itemRepo.create({ module_id: moduleId, name: 'Test', prompt: 'old' })
      itemRepo.update(id, { prompt: 'new', weight: 1.5 })
      const items = itemRepo.list(moduleId)
      const item = items.find((i) => i.id === id)!
      expect(item.prompt).toBe('new')
      expect(item.weight).toBe(1.5)
    })

    it('deletes an item', () => {
      const id = itemRepo.create({ module_id: moduleId, name: 'Test', prompt: 'p' })
      itemRepo.delete(id)
      expect(itemRepo.list(moduleId)).toHaveLength(0)
    })

    it('cascade deletes items when module is deleted', () => {
      itemRepo.create({ module_id: moduleId, name: 'A', prompt: 'a' })
      itemRepo.create({ module_id: moduleId, name: 'B', prompt: 'b' })
      moduleRepo.delete(moduleId)
      expect(itemRepo.list(moduleId)).toHaveLength(0)
    })

    it('orders items by sort_order', () => {
      itemRepo.create({ module_id: moduleId, name: 'Third', prompt: 'c', sort_order: 3 })
      itemRepo.create({ module_id: moduleId, name: 'First', prompt: 'a', sort_order: 1 })
      itemRepo.create({ module_id: moduleId, name: 'Second', prompt: 'b', sort_order: 2 })
      const items = itemRepo.list(moduleId)
      expect(items.map((i) => i.name)).toEqual(['First', 'Second', 'Third'])
    })

    it('reorders items and preserves the previous order if a later update fails', () => {
      const firstId = itemRepo.create({
        module_id: moduleId,
        name: 'First',
        prompt: 'a',
        sort_order: 0
      })
      const secondId = itemRepo.create({
        module_id: moduleId,
        name: 'Second',
        prompt: 'b',
        sort_order: 1
      })
      itemRepo.reorder([secondId, firstId])
      expect(itemRepo.list(moduleId).map((item) => item.id)).toEqual([secondId, firstId])
      const before = itemRepo.list(moduleId)
      mockDb.run(`CREATE TRIGGER reject_item_reorder BEFORE UPDATE OF sort_order ON module_items
        WHEN NEW.name = 'Second' BEGIN SELECT RAISE(ABORT, 'reorder failure'); END`)

      expect(() => itemRepo.reorder([firstId, secondId])).toThrow('reorder failure')
      expect(itemRepo.list(moduleId)).toEqual(before)
    })

    it('gets a single item by id', () => {
      const id = itemRepo.create({ module_id: moduleId, name: 'Test', prompt: 'p' })
      const item = itemRepo.get(id)
      expect(item).not.toBeNull()
      expect(item!.name).toBe('Test')
      expect(item!.prompt).toBe('p')
    })

    it('returns null for non-existent item', () => {
      expect(itemRepo.get('non-existent')).toBeNull()
    })

    it('counts items in a module', () => {
      expect(itemRepo.count(moduleId)).toBe(0)
      itemRepo.create({ module_id: moduleId, name: 'A', prompt: 'a' })
      itemRepo.create({ module_id: moduleId, name: 'B', prompt: 'b' })
      expect(itemRepo.count(moduleId)).toBe(2)
    })

    it('lists items with pagination', () => {
      for (let i = 0; i < 5; i++) {
        itemRepo.create({ module_id: moduleId, name: `Item${i}`, prompt: `p${i}`, sort_order: i })
      }
      const page1 = itemRepo.list(moduleId, { limit: 2, offset: 0 })
      expect(page1).toHaveLength(2)
      expect(page1[0].name).toBe('Item0')

      const page2 = itemRepo.list(moduleId, { limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)
      expect(page2[0].name).toBe('Item2')

      const page3 = itemRepo.list(moduleId, { limit: 2, offset: 4 })
      expect(page3).toHaveLength(1)
    })

    it('bulk updates multiple items', () => {
      const id1 = itemRepo.create({ module_id: moduleId, name: 'A', prompt: 'old1' })
      const id2 = itemRepo.create({ module_id: moduleId, name: 'B', prompt: 'old2' })
      const result = itemRepo.bulkUpdate([
        { id: id1, data: { prompt: 'new1', weight: 2.0 } },
        { id: id2, data: { prompt: 'new2' } }
      ])
      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(0)

      const item1 = itemRepo.get(id1)!
      expect(item1.prompt).toBe('new1')
      expect(item1.weight).toBe(2.0)
      expect(itemRepo.get(id2)!.prompt).toBe('new2')
    })

    it('bulk update skips items with no valid fields', () => {
      const id = itemRepo.create({ module_id: moduleId, name: 'A', prompt: 'p' })
      const result = itemRepo.bulkUpdate([{ id, data: { invalid_field: 'x' } }])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.errors[0].error).toContain('No valid fields')
    })

    it('reports missing bulk updates without losing successful changes or counting stale affected rows', () => {
      const firstId = itemRepo.create({ module_id: moduleId, name: 'A', prompt: 'old' })
      const secondId = itemRepo.create({ module_id: moduleId, name: 'B', prompt: 'keep' })

      const result = itemRepo.bulkUpdate([
        { id: 'missing-before', data: { prompt: 'missing' } },
        { id: firstId, data: { prompt: 'new' } },
        { id: 'missing-after', data: { prompt: 'missing' } },
        { id: secondId, data: { prompt: 'keep' } }
      ])

      expect(result).toEqual({
        succeeded: 2,
        failed: 2,
        errors: [
          { id: 'missing-before', error: 'Module item not found' },
          { id: 'missing-after', error: 'Module item not found' }
        ]
      })
      expect(itemRepo.get(firstId)?.prompt).toBe('new')
      expect(itemRepo.get(secondId)?.prompt).toBe('keep')
      expect(itemRepo.count(moduleId)).toBe(2)
    })

    it('persists enabled through single and bulk updates independently of weight', () => {
      const id = itemRepo.create({ module_id: moduleId, name: 'A', prompt: 'p', weight: 0 })

      itemRepo.update(id, { enabled: 0 })
      expect(itemRepo.get(id)).toMatchObject({ enabled: 0, weight: 0 })

      expect(itemRepo.bulkUpdate([{ id, data: { enabled: 1 } }])).toEqual({
        succeeded: 1,
        failed: 0,
        errors: []
      })
      expect(itemRepo.get(id)).toMatchObject({ enabled: 1, weight: 0 })
    })

    it('bulk update returns empty result for empty array', () => {
      const result = itemRepo.bulkUpdate([])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('bulk creates multiple items in a transaction', () => {
      const result = itemRepo.bulkCreate([
        { module_id: moduleId, name: 'A', prompt: 'prompt_a' },
        { module_id: moduleId, name: 'B', prompt: 'prompt_b', negative: 'neg_b' },
        { module_id: moduleId, name: 'C', prompt: 'prompt_c', weight: 1.5 }
      ])
      expect(result.succeeded).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.ids).toHaveLength(3)
      expect(result.ids.every((id) => id.length > 0)).toBe(true)
      expect(itemRepo.count(moduleId)).toBe(3)
    })

    it('bulk create assigns sequential sort_order by default', () => {
      const result = itemRepo.bulkCreate([
        { module_id: moduleId, name: 'First', prompt: 'p1' },
        { module_id: moduleId, name: 'Second', prompt: 'p2' },
        { module_id: moduleId, name: 'Third', prompt: 'p3' }
      ])
      const items = itemRepo.list(moduleId)
      expect(items[0].sort_order).toBe(0)
      expect(items[1].sort_order).toBe(1)
      expect(items[2].sort_order).toBe(2)
      expect(result.ids).toHaveLength(3)
    })

    it('bulk create handles prompt_variants', () => {
      const variants = JSON.stringify({
        tags: { prompt: 'tag_prompt', negative: 'tag_neg' }
      })
      const result = itemRepo.bulkCreate([
        { module_id: moduleId, name: 'V', prompt: 'base', prompt_variants: variants }
      ])
      expect(result.succeeded).toBe(1)
      const item = itemRepo.get(result.ids[0])
      expect(item!.prompt_variants).toBe(variants)
    })

    it('bulk create returns empty result for empty array', () => {
      const result = itemRepo.bulkCreate([])
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.ids).toHaveLength(0)
    })
  })

  describe('ModuleRepository duplicate', () => {
    let repo: ModuleRepository
    let itemRepo: ModuleItemRepository

    beforeEach(() => {
      repo = new ModuleRepository()
      itemRepo = new ModuleItemRepository()
    })

    it('duplicates a module with all items', () => {
      const sourceId = repo.create({ name: 'Source', type: 'character', description: 'desc' })
      itemRepo.create({ module_id: sourceId, name: 'Item1', prompt: 'p1', negative: 'n1' })
      itemRepo.create({
        module_id: sourceId,
        name: 'Item2',
        prompt: 'p2',
        prompt_variants: '{"tags":{"prompt":"tp","negative":"tn"}}'
      })

      const result = repo.duplicate(sourceId, 'Copy of Source')
      expect(result).not.toBeNull()
      expect(result!.itemsCopied).toBe(2)

      const newMod = repo.get(result!.newModuleId)
      expect(newMod).not.toBeNull()
      expect(newMod!.name).toBe('Copy of Source')
      expect(newMod!.type).toBe('character')
      expect(newMod!.description).toBe('desc')

      const newItems = itemRepo.list(result!.newModuleId)
      expect(newItems).toHaveLength(2)
      expect(newItems[0].name).toBe('Item1')
      expect(newItems[0].prompt).toBe('p1')
      expect(newItems[1].prompt_variants).toBe('{"tags":{"prompt":"tp","negative":"tn"}}')

      // Ensure original is unchanged
      expect(itemRepo.list(sourceId)).toHaveLength(2)
    })

    it('returns null for non-existent source', () => {
      const result = repo.duplicate('non-existent', 'Copy')
      expect(result).toBeNull()
    })

    it('duplicates an empty module', () => {
      const sourceId = repo.create({ name: 'Empty', type: 'emotion' })
      const result = repo.duplicate(sourceId, 'Copy of Empty')
      expect(result).not.toBeNull()
      expect(result!.itemsCopied).toBe(0)
      expect(itemRepo.list(result!.newModuleId)).toHaveLength(0)
    })
  })

  describe('BatchJobRepository', () => {
    let repo: BatchJobRepository

    beforeEach(() => {
      repo = new BatchJobRepository()
    })

    it('pages filtered summaries without config blobs and reports per-job uncertain counts', () => {
      const tasks = new BatchTaskRepository()
      const ids = ['First', 'Middle', 'Last'].map((name) =>
        repo.create({
          name,
          config: '{"private_config":true}',
          module_data_snapshot: '[{"large_snapshot":true}]',
          pipeline_config: '{"large_pipeline":true}'
        })
      )
      repo.reorder(ids)
      repo.updateStatus(ids[0], 'failed')
      repo.updateStatus(ids[2], 'failed')
      for (const [jobId, status] of [
        [ids[0], 'uncertain'],
        [ids[0], 'failed'],
        [ids[1], 'uncertain']
      ]) {
        const taskId = tasks.createSingle({
          job_id: jobId,
          prompt_data: '{}',
          sort_order: 0,
          metadata: '{}'
        })
        tasks.updateStatus(taskId, status)
      }

      const first = repo.listSummaries(1, 0, 'failed')
      expect(first.total).toBe(2)
      expect(first.items).toHaveLength(1)
      expect(first.items[0]).toMatchObject({ id: ids[0], name: 'First', uncertain_tasks: 1 })
      const second = repo.listSummaries(1, 1, 'failed')
      expect(second.total).toBe(2)
      expect(second.items).toHaveLength(1)
      expect(second.items[0]).toMatchObject({ id: ids[2], uncertain_tasks: 0 })
      expect(repo.listSummaries(1, 2, 'failed')).toEqual({ items: [], total: 2 })
      const all = repo.listSummaries(10, 0)
      expect(all.total).toBe(3)
      expect(all.items.map((item) => item.id)).toEqual(ids)
      expect(all.items.map((item) => item.uncertain_tasks)).toEqual([1, 1, 0])
      for (const item of all.items) {
        expect(item).not.toHaveProperty('config')
        expect(item).not.toHaveProperty('module_data_snapshot')
        expect(item).not.toHaveProperty('pipeline_config')
      }
    })

    it('creates and retrieves a job', () => {
      const id = repo.create({ name: 'Job 1', config: '{}' })
      const job = repo.get(id)
      expect(job).not.toBeNull()
      expect(job!.name).toBe('Job 1')
      expect(job!.status).toBe('draft')
    })

    it('lists jobs', () => {
      repo.create({ name: 'J1', config: '{}' })
      repo.create({ name: 'J2', config: '{}' })
      expect(repo.listSummaries(-1, 0).items).toHaveLength(2)
    })

    it('filters by status', () => {
      const id1 = repo.create({ name: 'J1', config: '{}' })
      repo.create({ name: 'J2', config: '{}' })
      repo.updateStatus(id1, 'running')
      expect(repo.listSummaries(-1, 0, 'running').items).toHaveLength(1)
      expect(repo.listSummaries(-1, 0, 'draft').items).toHaveLength(1)
    })

    it('updates status', () => {
      const id = repo.create({ name: 'J', config: '{}' })
      repo.updateStatus(id, 'running')
      expect(repo.get(id)!.status).toBe('running')
    })

    it('updates progress', () => {
      const id = repo.create({ name: 'J', config: '{}', total_tasks: 10 })
      repo.updateProgress(id, 5, 1)
      const job = repo.get(id)
      expect(job!.completed_tasks).toBe(5)
      expect(job!.failed_tasks).toBe(1)
    })

    it('deletes a job', () => {
      const id = repo.create({ name: 'J', config: '{}' })
      repo.delete(id)
      expect(repo.get(id)).toBeNull()
    })

    it('updates an unstarted draft and clears its generated task rows atomically', () => {
      const taskRepo = new BatchTaskRepository()
      const id = repo.create({ name: 'Before', config: '{"before":true}', total_tasks: 1 })
      taskRepo.createSingle({ job_id: id, prompt_data: '{}', sort_order: 0, metadata: '{}' })
      repo.updateDraft(id, {
        name: 'After',
        description: 'Updated',
        config: '{"after":true}',
        total_tasks: 3,
        module_data_snapshot: '[]'
      })

      expect(taskRepo.listByJob(id)).toHaveLength(0)
      expect(repo.get(id)).toMatchObject({
        name: 'After',
        description: 'Updated',
        config: '{"after":true}',
        total_tasks: 3,
        completed_tasks: 0,
        failed_tasks: 0,
        status: 'draft'
      })
      taskRepo.createSingle({
        job_id: id,
        prompt_data: '{"retained":true}',
        sort_order: 0,
        metadata: '{}'
      })
      const beforeJob = repo.get(id)
      const beforeTasks = taskRepo.listByJob(id)
      mockDb.run(`CREATE TRIGGER reject_draft_edit BEFORE UPDATE ON batch_jobs
        BEGIN SELECT RAISE(ABORT, 'draft edit failure'); END`)

      expect(() => repo.updateDraft(id, { name: 'Rejected', config: '{}' })).toThrow(
        'draft edit failure'
      )
      expect(repo.get(id)).toEqual(beforeJob)
      expect(taskRepo.listByJob(id)).toEqual(beforeTasks)
    })

    it('rejects edits after a draft has started and preserves the original job', () => {
      const id = repo.create({ name: 'Original', config: '{}' })
      repo.updateStatus(id, 'running')

      expect(() => repo.updateDraft(id, { name: 'Changed', config: '{}' })).toThrow(
        'Only unstarted draft jobs can be edited'
      )
      expect(repo.get(id)?.name).toBe('Original')
      expect(repo.get(id)?.status).toBe('running')
    })

    it('reorders jobs and preserves the previous order if a later update fails', () => {
      const firstId = repo.create({ name: 'First', config: '{}' })
      const secondId = repo.create({ name: 'Second', config: '{}' })
      repo.reorder([secondId, firstId])
      expect(repo.listSummaries(-1, 0).items.map((job) => job.id)).toEqual([secondId, firstId])
      const before = repo.listSummaries(-1, 0)
      mockDb.run(`CREATE TRIGGER reject_job_reorder BEFORE UPDATE OF sort_order ON batch_jobs
        WHEN NEW.name = 'Second' BEGIN SELECT RAISE(ABORT, 'reorder failure'); END`)

      expect(() => repo.reorder([firstId, secondId])).toThrow('reorder failure')
      expect(repo.listSummaries(-1, 0)).toEqual(before)
    })
  })

  describe('BatchTaskRepository', () => {
    let jobRepo: BatchJobRepository
    let taskRepo: BatchTaskRepository
    let jobId: string

    beforeEach(() => {
      jobRepo = new BatchJobRepository()
      taskRepo = new BatchTaskRepository()
      jobId = jobRepo.create({ name: 'Job', config: '{}' })
    })

    it('creates tasks and lists them', () => {
      for (const task of [
        { job_id: jobId, prompt_data: '{"p":"1"}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"p":"2"}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"p":"3"}', sort_order: 2, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks).toHaveLength(3)
    })

    it('tasks are ordered by sort_order', () => {
      for (const task of [
        { job_id: jobId, prompt_data: '{"order":2}', sort_order: 2, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"order":0}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"order":1}', sort_order: 1, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks.map((t) => t.sort_order)).toEqual([0, 1, 2])
    })

    it('paginates tasks by stable order, applying status and job filters before pagination', () => {
      const otherJobId = jobRepo.create({ name: 'Other job', config: '{}' })
      for (const row of [
        { id: 'late', jobId, order: 3, status: 'uncertain' },
        { id: 'tie-b', jobId, order: 1, status: 'uncertain' },
        { id: 'pending', jobId, order: 0, status: 'pending' },
        { id: 'tie-a', jobId, order: 1, status: 'uncertain' },
        { id: 'other', jobId: otherJobId, order: 0, status: 'uncertain' }
      ]) {
        mockDb.run(
          'INSERT INTO batch_tasks (id, job_id, sort_order, status, prompt_data) VALUES (?, ?, ?, ?, ?)',
          [row.id, row.jobId, row.order, row.status, '{}']
        )
      }

      expect(taskRepo.listPage(jobId, 2, 0).map((task) => task.id)).toEqual(['pending', 'tie-a'])
      expect(taskRepo.listPage(jobId, 2, 2).map((task) => task.id)).toEqual(['tie-b', 'late'])
      expect(taskRepo.listPage(jobId, 2, 0, 'uncertain').map((task) => task.id)).toEqual([
        'tie-a',
        'tie-b'
      ])
      expect(taskRepo.listPage(jobId, 2, 2, 'uncertain').map((task) => task.id)).toEqual(['late'])
      expect(taskRepo.listPage(jobId, 2, 4)).toEqual([])
      expect(taskRepo.listPage(jobId, 2, 0, 'completed')).toEqual([])
      expect(taskRepo.listPage('missing', 2, 0)).toEqual([])
      expect(taskRepo.listPage(jobId, 2, 0, "uncertain' OR 1=1 --")).toEqual([])
    })

    it('updates task status', () => {
      taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
      const tasks = taskRepo.listByJob(jobId)
      const taskId = tasks[0].id as string
      taskRepo.updateStatus(taskId, 'running')
      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('running')
    })

    it('updates status with extra fields', () => {
      taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
      const taskId = taskRepo.listByJob(jobId)[0].id as string
      taskRepo.updateStatus(taskId, 'completed', {
        comfyui_prompt_id: 'prompt-123',
        result_path: '/output/image.png'
      })
      const task = taskRepo.listByJob(jobId)[0]
      expect(task.status).toBe('completed')
      expect(task.comfyui_prompt_id).toBe('prompt-123')
      expect(task.result_path).toBe('/output/image.png')
    })

    it('increments retry_count on retrying status', () => {
      taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
      const taskId = taskRepo.listByJob(jobId)[0].id as string
      taskRepo.updateStatus(taskId, 'retrying')
      taskRepo.updateStatus(taskId, 'retrying')
      const task = taskRepo.listByJob(jobId)[0]
      expect(task.retry_count).toBe(2)
    })

    it('lists only pending and retrying tasks for execution', () => {
      for (const task of [
        { job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 2, metadata: '{}' },
        { job_id: jobId, prompt_data: '{}', sort_order: 3, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[1].id as string, 'retrying')
      taskRepo.updateStatus(tasks[2].id as string, 'failed')
      taskRepo.updateStatus(tasks[3].id as string, 'completed')

      expect(taskRepo.listByJobPending(jobId, 50).map((task) => task.status)).toEqual([
        'pending',
        'retrying'
      ])
    })

    it('cascade deletes tasks when job is deleted', () => {
      taskRepo.createSingle({ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' })
      jobRepo.delete(jobId)
      expect(taskRepo.listByJob(jobId)).toHaveLength(0)
    })

    it('preserves prompt IDs when recovering known running requests', () => {
      for (const task of [
        { job_id: jobId, prompt_data: '{"a":1}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":2}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":3}', sort_order: 2, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')
      taskRepo.updateStatus(tasks[1].id as string, 'running', { comfyui_prompt_id: 'p-1' })
      taskRepo.updateStatus(tasks[2].id as string, 'running', { comfyui_prompt_id: 'p-2' })

      taskRepo.resetRunningTasksByJob(jobId)

      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('pending')
      expect(updated[1].comfyui_prompt_id).toBe('p-1')
      expect(updated[2].status).toBe('pending')
      expect(updated[2].comfyui_prompt_id).toBe('p-2')
    })

    it('cancels unsubmitted tasks while preserving failures and unresolved execution', () => {
      for (const task of [
        { job_id: jobId, prompt_data: '{"a":1}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":2}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":3}', sort_order: 2, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":4}', sort_order: 3, metadata: '{}' }
      ]) {
        taskRepo.createSingle(task)
      }
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')
      taskRepo.updateStatus(tasks[1].id as string, 'running')
      taskRepo.updateStatus(tasks[2].id as string, 'failed')
      // tasks[3] stays 'pending'

      taskRepo.cancelRemainingTasksByJob(jobId)

      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('uncertain')
      expect(updated[2].status).toBe('failed')
      expect(updated[3].status).toBe('cancelled')
    })

    it('quarantines submissions without a confirmed response on recovery', () => {
      for (const status of ['submitting', 'running', 'uncertain']) {
        const id = taskRepo.createSingle({
          job_id: jobId,
          prompt_data: '{}',
          sort_order: 0,
          metadata: '{}'
        })
        taskRepo.updateStatus(id, status)
      }
      taskRepo.resetRunningTasksByJob(jobId)
      expect(taskRepo.countByJobStatus(jobId)).toEqual({ uncertain: 3 })
      expect(taskRepo.listByJobPending(jobId, 50)).toEqual([])
      expect(jobRepo.get(jobId)?.uncertain_tasks).toBe(3)
      expect(
        jobRepo.listSummaries(-1, 0).items.find((job) => job.id === jobId)?.uncertain_tasks
      ).toBe(3)
    })

    it('never converts a remotely submitted or uncertain task into confirmed cancellation', () => {
      const states = [
        'pending',
        'retrying',
        'running',
        'submitting',
        'uncertain',
        'completed',
        'failed'
      ]
      const ids = states.map((status, index) => {
        const id = taskRepo.createSingle({
          job_id: jobId,
          prompt_data: '{}',
          sort_order: index,
          metadata: '{}'
        })
        taskRepo.updateStatus(id, status, { comfyui_prompt_id: `remote-${index}` })
        return id
      })
      taskRepo.cancelRemainingTasksByJob(jobId)
      expect(ids.map((id) => taskRepo.get(id)?.status)).toEqual([
        'uncertain',
        'uncertain',
        'uncertain',
        'uncertain',
        'uncertain',
        'completed',
        'failed'
      ])
      expect(ids.map((id) => taskRepo.get(id)?.comfyui_prompt_id)).toEqual(
        states.map((_, index) => `remote-${index}`)
      )
      expect(jobRepo.get(jobId)?.uncertain_tasks).toBe(5)
    })

    it('derives lazy expansion position from allocated indexes, including unresolved tasks', () => {
      expect(taskRepo.nextSortOrder(jobId)).toBe(0)
      const id = taskRepo.createSingle({
        job_id: jobId,
        prompt_data: '{}',
        sort_order: 7,
        metadata: '{}'
      })
      taskRepo.updateStatus(id, 'uncertain', { comfyui_prompt_id: 'remote' })
      expect(taskRepo.nextSortOrder(jobId)).toBe(8)
      expect(taskRepo.get('missing')).toBeNull()
      taskRepo.updateStatus(id, 'retrying', { comfyui_prompt_id: null })
      expect(taskRepo.get(id)?.comfyui_prompt_id).toBeNull()
    })
  })

  describe('GeneratedImageRepository', () => {
    let repo: GeneratedImageRepository

    beforeEach(() => {
      repo = new GeneratedImageRepository()
    })

    it('creates and lists images', () => {
      repo.create({ file_path: '/img/1.png', character_name: 'Alice' })
      repo.create({ file_path: '/img/2.png', character_name: 'Bob' })
      const result = repo.list({ page: 1, pageSize: 50 })
      expect(result.total).toBe(2)
      expect(result.items).toHaveLength(2)
    })

    it('gets the requested image with its review metadata and returns null for missing IDs', () => {
      const id = repo.create({
        file_path: '/img/alice.png',
        character_name: 'Alice',
        emotion_name: 'happy',
        prompt_text: 'smile',
        generation_params: '{"seed":42}'
      })
      repo.create({ file_path: '/img/bob.png', character_name: 'Bob' })
      repo.updateRating(id, 4)
      repo.updateFavorite(id, true)

      expect(repo.get(id)).toMatchObject({
        id,
        file_path: '/img/alice.png',
        character_name: 'Alice',
        emotion_name: 'happy',
        prompt_text: 'smile',
        generation_params: '{"seed":42}',
        rating: 4,
        is_favorite: 1
      })
      expect(repo.get('missing')).toBeNull()
      expect(repo.get("' OR 1=1 --")).toBeNull()
    })

    it('recognizes a stored file path as a tracked gallery asset', () => {
      repo.create({ file_path: '/img/test.png' })

      expect(repo.hasTrackedAssetPath('/img/test.png')).toBe(true)
    })

    it('recognizes a stored thumbnail path as a tracked gallery asset', () => {
      repo.create({ file_path: '/img/test.png', thumbnail_path: '/img/test-thumb.png' })

      expect(repo.hasTrackedAssetPath('/img/test-thumb.png')).toBe(true)
    })

    it('returns false for an untracked gallery asset path', () => {
      repo.create({ file_path: '/img/test.png', thumbnail_path: '/img/test-thumb.png' })

      expect(repo.hasTrackedAssetPath('/img/other.png')).toBe(false)
    })

    it('matches when any candidate tracked asset path is provided', () => {
      repo.create({ file_path: '/img/test.png', thumbnail_path: '/img/test-thumb.png' })

      expect(repo.hasTrackedAssetPath(['/img/alias.png', '/img/test-thumb.png'])).toBe(true)
    })

    it('frees the prepared statement when tracked path binding throws', () => {
      const free = vi.fn()
      const originalPrepare = mockDb.prepare.bind(mockDb)

      mockDb.prepare = vi.fn(() => ({
        bind: () => {
          throw new Error('bind failed')
        },
        step: vi.fn(),
        free
      })) as unknown as typeof mockDb.prepare

      try {
        expect(() => repo.hasTrackedAssetPath('/img/test.png')).toThrow('bind failed')
        expect(free).toHaveBeenCalledTimes(1)
      } finally {
        mockDb.prepare = originalPrepare
      }
    })

    it('paginates results', () => {
      for (let i = 0; i < 15; i++) {
        repo.create({ file_path: `/img/${i}.png` })
      }
      const page1 = repo.list({ page: 1, pageSize: 10 })
      expect(page1.items).toHaveLength(10)
      expect(page1.total).toBe(15)

      const page2 = repo.list({ page: 2, pageSize: 10 })
      expect(page2.items).toHaveLength(5)
    })

    it('filters by character name', () => {
      repo.create({ file_path: '/1.png', character_name: 'Alice' })
      repo.create({ file_path: '/2.png', character_name: 'Bob' })
      const result = repo.list({ page: 1, pageSize: 50, characterName: 'Alice' })
      expect(result.total).toBe(1)
    })

    it('filters by minimum rating', () => {
      const id1 = repo.create({ file_path: '/1.png' })
      const id2 = repo.create({ file_path: '/2.png' })
      repo.updateRating(id1, 5)
      repo.updateRating(id2, 2)
      const result = repo.list({ page: 1, pageSize: 50, minRating: 4 })
      expect(result.total).toBe(1)
    })

    it('filters by favorite', () => {
      const id1 = repo.create({ file_path: '/1.png' })
      repo.create({ file_path: '/2.png' })
      repo.updateFavorite(id1, true)
      const result = repo.list({ page: 1, pageSize: 50, isFavorite: true })
      expect(result.total).toBe(1)
    })

    it('updates rating', () => {
      const id = repo.create({ file_path: '/1.png' })
      repo.updateRating(id, 4)
      const result = repo.list({ page: 1, pageSize: 50 })
      expect(result.items[0].rating).toBe(4)
    })

    it('updates favorite', () => {
      const id = repo.create({ file_path: '/1.png' })
      repo.updateFavorite(id, true)
      const result = repo.list({ page: 1, pageSize: 50 })
      expect(result.items[0].is_favorite).toBe(1)
    })

    it('deletes images', () => {
      const id1 = repo.create({ file_path: '/1.png' })
      const id2 = repo.create({ file_path: '/2.png' })
      repo.create({ file_path: '/3.png' })
      repo.delete([id1, id2])
      expect(repo.list({ page: 1, pageSize: 50 }).total).toBe(1)
    })

    it('creates image with all fields', () => {
      repo.create({
        file_path: '/img/test.png',
        thumbnail_path: '/img/thumb.png',
        file_size: 1024,
        width: 512,
        height: 768,
        prompt_text: 'masterpiece',
        negative_text: 'bad quality',
        character_name: 'Alice',
        outfit_name: 'dress',
        emotion_name: 'happy',
        style_name: 'anime'
      })
      const result = repo.list({ page: 1, pageSize: 50 })
      const img = result.items[0]
      expect(img.file_path).toBe('/img/test.png')
      expect(img.width).toBe(512)
      expect(img.character_name).toBe('Alice')
    })

    it('sorts by rating descending', () => {
      const id1 = repo.create({ file_path: '/1.png' })
      const id2 = repo.create({ file_path: '/2.png' })
      const id3 = repo.create({ file_path: '/3.png' })
      repo.updateRating(id1, 1)
      repo.updateRating(id2, 5)
      repo.updateRating(id3, 3)
      const result = repo.list({ page: 1, pageSize: 50, sortBy: 'rating', sortOrder: 'desc' })
      const ratings = result.items.map((i) => i.rating)
      expect(ratings).toEqual([5, 3, 1])
    })

    it('does not interpolate invalid sort fields into SQL', () => {
      repo.create({ file_path: '/1.png' })
      repo.create({ file_path: '/2.png' })

      expect(() =>
        repo.list({
          page: 1,
          pageSize: 50,
          sortBy: 'created_at; DROP TABLE generated_images --',
          sortOrder: 'desc'
        })
      ).not.toThrow()

      expect(repo.list({ page: 1, pageSize: 50 }).total).toBe(2)
    })

    it('filters by searchText (filename match)', () => {
      repo.create({ file_path: '/output/alice_001.png' })
      repo.create({ file_path: '/output/bob_002.png' })
      repo.create({ file_path: '/output/alice_003.png' })

      const result = repo.list({ page: 1, pageSize: 50, searchText: 'alice' })
      expect(result.total).toBe(2)
      expect(result.items).toHaveLength(2)
    })

    it('returns no results for non-matching searchText', () => {
      repo.create({ file_path: '/output/test.png' })
      const result = repo.list({ page: 1, pageSize: 50, searchText: 'nonexistent' })
      expect(result.total).toBe(0)
    })

    it('combines searchText with other filters', () => {
      repo.create({ file_path: '/output/alice_001.png', character_name: 'Alice' })
      repo.create({ file_path: '/output/alice_002.png', character_name: 'Bob' })
      repo.create({ file_path: '/output/bob_001.png', character_name: 'Alice' })

      const result = repo.list({
        page: 1,
        pageSize: 50,
        searchText: 'alice',
        characterName: 'Alice'
      })
      expect(result.total).toBe(1)
    })
  })
})
