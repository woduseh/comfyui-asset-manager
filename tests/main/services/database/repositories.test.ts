import { describe, it, expect, beforeEach, vi } from 'vitest'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

// Mock the database module before importing repositories
let mockDb: SqlJsDatabase

vi.mock('../../../../src/main/services/database/index', () => ({
  getDatabase: () => mockDb,
  saveDatabase: vi.fn()
}))

// Import after mocking
import {
  SettingsRepository,
  WorkflowRepository,
  ModuleRepository,
  ModuleItemRepository,
  CharacterRepository,
  BatchJobRepository,
  BatchTaskRepository,
  GeneratedImageRepository
} from '../../../../src/main/services/database/repositories/index'

// Create tables helper (mirroring src/main/services/database/index.ts)
function createTables(db: SqlJsDatabase): void {
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  db.run(`CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'generation', api_json TEXT NOT NULL,
    ui_json TEXT, variables TEXT NOT NULL DEFAULT '[]', thumbnail BLOB,
    created_at DATETIME DEFAULT (datetime('now')), updated_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS workflow_variables (
    id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL, field_name TEXT NOT NULL, display_name TEXT NOT NULL,
    var_type TEXT NOT NULL DEFAULT 'text', default_val TEXT, description TEXT,
    role TEXT NOT NULL DEFAULT 'custom'
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS prompt_modules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, description TEXT DEFAULT '',
    is_template INTEGER DEFAULT 0, parent_id TEXT REFERENCES prompt_modules(id),
    created_at DATETIME DEFAULT (datetime('now')), updated_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS module_items (
    id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES prompt_modules(id) ON DELETE CASCADE,
    name TEXT NOT NULL, prompt TEXT NOT NULL, negative TEXT DEFAULT '', weight REAL DEFAULT 1.0,
    sort_order INTEGER DEFAULT 0, metadata TEXT DEFAULT '{}', thumbnail BLOB, enabled INTEGER DEFAULT 1,
    prompt_variants TEXT DEFAULT '{}'
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_prompt TEXT NOT NULL,
    negative_prompt TEXT DEFAULT '', thumbnail BLOB, metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', config TEXT NOT NULL, workflow_id TEXT REFERENCES workflows(id),
    total_tasks INTEGER DEFAULT 0, completed_tasks INTEGER DEFAULT 0, failed_tasks INTEGER DEFAULT 0,
    pipeline_config TEXT, created_at DATETIME DEFAULT (datetime('now')),
    started_at DATETIME, completed_at DATETIME, sort_order INTEGER DEFAULT 0,
    module_data_snapshot TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS batch_tasks (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending', prompt_data TEXT NOT NULL, comfyui_prompt_id TEXT,
    result_path TEXT, error_message TEXT, retry_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0, metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT (datetime('now')), completed_at DATETIME
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY, task_id TEXT REFERENCES batch_tasks(id),
    job_id TEXT REFERENCES batch_jobs(id), file_path TEXT NOT NULL,
    thumbnail_path TEXT, file_size INTEGER, width INTEGER, height INTEGER,
    generation_params TEXT DEFAULT '{}', prompt_text TEXT, negative_text TEXT,
    rating INTEGER DEFAULT 0, is_favorite INTEGER DEFAULT 0, tags TEXT DEFAULT '[]',
    character_name TEXT, outfit_name TEXT, emotion_name TEXT, style_name TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_module_items_module ON module_items(module_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_batch_tasks_job ON batch_tasks(job_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_generated_images_job ON generated_images(job_id)`)
  db.run(
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('comfyui_host', 'localhost'), ('comfyui_port', '8188')`
  )
  db.run('PRAGMA foreign_keys = ON;')
}

describe('Database Repositories', () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    mockDb = new SQL.Database()
    createTables(mockDb)
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

  describe('CharacterRepository', () => {
    let repo: CharacterRepository

    beforeEach(() => {
      repo = new CharacterRepository()
    })

    it('creates and gets a character', () => {
      const id = repo.create({ name: 'Alice', base_prompt: '1girl, alice' })
      const char = repo.get(id)
      expect(char).not.toBeNull()
      expect(char!.name).toBe('Alice')
    })

    it('lists characters alphabetically', () => {
      repo.create({ name: 'Charlie', base_prompt: 'c' })
      repo.create({ name: 'Alice', base_prompt: 'a' })
      repo.create({ name: 'Bob', base_prompt: 'b' })
      const list = repo.list()
      expect(list.map((c) => c.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('updates a character', () => {
      const id = repo.create({ name: 'Old', base_prompt: 'old' })
      repo.update(id, { name: 'New' })
      expect(repo.get(id)!.name).toBe('New')
    })

    it('deletes a character', () => {
      const id = repo.create({ name: 'Del', base_prompt: 'del' })
      repo.delete(id)
      expect(repo.get(id)).toBeNull()
    })
  })

  describe('BatchJobRepository', () => {
    let repo: BatchJobRepository

    beforeEach(() => {
      repo = new BatchJobRepository()
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
      expect(repo.list()).toHaveLength(2)
    })

    it('filters by status', () => {
      const id1 = repo.create({ name: 'J1', config: '{}' })
      repo.create({ name: 'J2', config: '{}' })
      repo.updateStatus(id1, 'running')
      expect(repo.list('running')).toHaveLength(1)
      expect(repo.list('draft')).toHaveLength(1)
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

    it('creates bulk tasks and lists them', () => {
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{"p":"1"}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"p":"2"}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"p":"3"}', sort_order: 2, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks).toHaveLength(3)
    })

    it('tasks are ordered by sort_order', () => {
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{"order":2}', sort_order: 2, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"order":0}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"order":1}', sort_order: 1, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      expect(tasks.map((t) => t.sort_order)).toEqual([0, 1, 2])
    })

    it('updates task status', () => {
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
      const tasks = taskRepo.listByJob(jobId)
      const taskId = tasks[0].id as string
      taskRepo.updateStatus(taskId, 'running')
      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('running')
    })

    it('updates status with extra fields', () => {
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
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
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
      const taskId = taskRepo.listByJob(jobId)[0].id as string
      taskRepo.updateStatus(taskId, 'retrying')
      taskRepo.updateStatus(taskId, 'retrying')
      const task = taskRepo.listByJob(jobId)[0]
      expect(task.retry_count).toBe(2)
    })

    it('cascade deletes tasks when job is deleted', () => {
      taskRepo.createBulk([{ job_id: jobId, prompt_data: '{}', sort_order: 0, metadata: '{}' }])
      jobRepo.delete(jobId)
      expect(taskRepo.listByJob(jobId)).toHaveLength(0)
    })

    it('resetRunningTasksByJob resets only running tasks to pending', () => {
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{"a":1}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":2}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":3}', sort_order: 2, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')
      taskRepo.updateStatus(tasks[1].id as string, 'running', { comfyui_prompt_id: 'p-1' })
      taskRepo.updateStatus(tasks[2].id as string, 'running', { comfyui_prompt_id: 'p-2' })

      taskRepo.resetRunningTasksByJob(jobId)

      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('pending')
      expect(updated[1].comfyui_prompt_id).toBeNull()
      expect(updated[2].status).toBe('pending')
      expect(updated[2].comfyui_prompt_id).toBeNull()
    })

    it('cancelRemainingTasksByJob cancels all non-completed tasks', () => {
      taskRepo.createBulk([
        { job_id: jobId, prompt_data: '{"a":1}', sort_order: 0, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":2}', sort_order: 1, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":3}', sort_order: 2, metadata: '{}' },
        { job_id: jobId, prompt_data: '{"a":4}', sort_order: 3, metadata: '{}' }
      ])
      const tasks = taskRepo.listByJob(jobId)
      taskRepo.updateStatus(tasks[0].id as string, 'completed')
      taskRepo.updateStatus(tasks[1].id as string, 'running')
      taskRepo.updateStatus(tasks[2].id as string, 'failed')
      // tasks[3] stays 'pending'

      taskRepo.cancelRemainingTasksByJob(jobId)

      const updated = taskRepo.listByJob(jobId)
      expect(updated[0].status).toBe('completed')
      expect(updated[1].status).toBe('cancelled')
      expect(updated[2].status).toBe('cancelled')
      expect(updated[3].status).toBe('cancelled')
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
