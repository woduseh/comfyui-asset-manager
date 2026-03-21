import { getDatabase, saveDatabase } from '../index'
import { v4 as uuidv4 } from 'uuid'
import log from '../../../logger'

// Allowed field names for dynamic update queries (SQL injection prevention)
const ALLOWED_UPDATE_FIELDS = {
  workflows: ['name', 'description', 'category', 'api_json', 'ui_json', 'variables'],
  prompt_modules: ['name', 'type', 'description', 'parent_id'],
  module_items: [
    'name',
    'prompt',
    'negative',
    'weight',
    'sort_order',
    'metadata',
    'module_id',
    'prompt_variants'
  ],
  characters: ['name', 'base_prompt', 'negative_prompt', 'metadata']
} as const

function sanitizeUpdateFields(
  data: Partial<Record<string, unknown>>,
  allowedFields: readonly string[]
): Partial<Record<string, unknown>> {
  const filtered: Partial<Record<string, unknown>> = {}
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      filtered[key] = data[key]
    }
  }
  return filtered
}

interface SettingRecord {
  key: string
  value: string
}

export class SettingsRepository {
  get(key: string): string | null {
    const db = getDatabase()
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    stmt.bind([key])
    if (stmt.step()) {
      const row = stmt.getAsObject() as SettingRecord
      stmt.free()
      return row.value
    }
    stmt.free()
    return null
  }

  set(key: string, value: string): void {
    const db = getDatabase()
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
    saveDatabase()
  }

  getAll(): Record<string, string> {
    const db = getDatabase()
    const result: Record<string, string> = {}
    const stmt = db.prepare('SELECT key, value FROM settings')
    while (stmt.step()) {
      const row = stmt.getAsObject() as SettingRecord
      result[row.key] = row.value
    }
    stmt.free()
    return result
  }

  delete(key: string): void {
    const db = getDatabase()
    db.run('DELETE FROM settings WHERE key = ?', [key])
    saveDatabase()
  }
}

export class WorkflowRepository {
  list(category?: string): Record<string, unknown>[] {
    const db = getDatabase()
    let query =
      'SELECT id, name, description, category, variables, created_at, updated_at FROM workflows'
    const params: unknown[] = []
    if (category) {
      query += ' WHERE category = ?'
      params.push(category)
    }
    query += ' ORDER BY updated_at DESC'
    const stmt = db.prepare(query)
    if (params.length) stmt.bind(params as string[])
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  get(id: string): Record<string, unknown> | null {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM workflows WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return row
    }
    stmt.free()
    return null
  }

  create(data: {
    name: string
    description?: string
    category: string
    api_json: string
    ui_json?: string
    variables?: string
  }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO workflows (id, name, description, category, api_json, ui_json, variables)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.description || '',
        data.category,
        data.api_json,
        data.ui_json || null,
        data.variables || '[]'
      ]
    )
    saveDatabase()
    return id
  }

  update(id: string, data: Partial<Record<string, unknown>>): void {
    const db = getDatabase()
    const sanitized = sanitizeUpdateFields(data, ALLOWED_UPDATE_FIELDS.workflows)
    const fields = Object.keys(sanitized)
    if (fields.length === 0) return
    const setClauses = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => sanitized[f])
    db.run(`UPDATE workflows SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`, [
      ...(values as string[]),
      id
    ])
    saveDatabase()
  }

  delete(id: string): void {
    const db = getDatabase()
    db.run('DELETE FROM workflows WHERE id = ?', [id])
    saveDatabase()
  }

  getVariables(workflowId: string): Record<string, unknown>[] {
    const db = getDatabase()
    const stmt = db.prepare(
      'SELECT * FROM workflow_variables WHERE workflow_id = ? ORDER BY node_id'
    )
    stmt.bind([workflowId])
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  setVariables(
    workflowId: string,
    variables: Array<{
      node_id: string
      field_name: string
      display_name: string
      var_type: string
      default_val?: string
      description?: string
      role?: string
    }>
  ): void {
    const db = getDatabase()
    db.run('DELETE FROM workflow_variables WHERE workflow_id = ?', [workflowId])
    for (const v of variables) {
      const id = uuidv4()
      db.run(
        `INSERT INTO workflow_variables (id, workflow_id, node_id, field_name, display_name, var_type, default_val, description, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          workflowId,
          v.node_id,
          v.field_name,
          v.display_name,
          v.var_type,
          v.default_val || null,
          v.description || null,
          v.role || 'custom'
        ]
      )
    }
    saveDatabase()
  }

  updateVariableRole(variableId: string, role: string): void {
    const db = getDatabase()
    db.run('UPDATE workflow_variables SET role = ? WHERE id = ?', [role, variableId])
    saveDatabase()
  }

  updateValue(variableId: string, value: string): void {
    const db = getDatabase()
    db.run('UPDATE workflow_variables SET default_val = ? WHERE id = ?', [value, variableId])
    saveDatabase()
  }
}

export class ModuleRepository {
  list(type?: string): Record<string, unknown>[] {
    const db = getDatabase()
    let query = 'SELECT * FROM prompt_modules'
    const params: unknown[] = []
    if (type) {
      query += ' WHERE type = ?'
      params.push(type)
    }
    query += ' ORDER BY updated_at DESC'
    const stmt = db.prepare(query)
    if (params.length) stmt.bind(params as string[])
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  get(id: string): Record<string, unknown> | null {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM prompt_modules WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return row
    }
    stmt.free()
    return null
  }

  create(data: { name: string; type: string; description?: string; parent_id?: string }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO prompt_modules (id, name, type, description, parent_id)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.name, data.type, data.description || '', data.parent_id || null]
    )
    saveDatabase()
    return id
  }

  update(id: string, data: Partial<Record<string, unknown>>): void {
    const db = getDatabase()
    const sanitized = sanitizeUpdateFields(data, ALLOWED_UPDATE_FIELDS.prompt_modules)
    const fields = Object.keys(sanitized)
    if (fields.length === 0) return
    const setClauses = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => sanitized[f])
    db.run(`UPDATE prompt_modules SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`, [
      ...(values as string[]),
      id
    ])
    saveDatabase()
  }

  delete(id: string): void {
    const db = getDatabase()
    db.run('DELETE FROM prompt_modules WHERE id = ?', [id])
    saveDatabase()
  }
}

export class ModuleItemRepository {
  list(moduleId: string, options?: { limit?: number; offset?: number }): Record<string, unknown>[] {
    const db = getDatabase()
    let sql = 'SELECT * FROM module_items WHERE module_id = ? ORDER BY sort_order ASC'
    const params: (string | number)[] = [moduleId]

    if (options?.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(options.limit)
      if (options?.offset !== undefined) {
        sql += ' OFFSET ?'
        params.push(options.offset)
      }
    }

    const stmt = db.prepare(sql)
    stmt.bind(params)
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  count(moduleId: string): number {
    const db = getDatabase()
    const stmt = db.prepare('SELECT COUNT(*) as count FROM module_items WHERE module_id = ?')
    stmt.bind([moduleId])
    stmt.step()
    const result = stmt.getAsObject() as { count: number }
    stmt.free()
    return result.count
  }

  get(id: string): Record<string, unknown> | null {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM module_items WHERE id = ?')
    stmt.bind([id])
    const found = stmt.step()
    const result = found ? stmt.getAsObject() : null
    stmt.free()
    return result
  }

  create(data: {
    module_id: string
    name: string
    prompt: string
    negative?: string
    weight?: number
    sort_order?: number
    metadata?: string
    prompt_variants?: string
  }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO module_items (id, module_id, name, prompt, negative, weight, sort_order, metadata, prompt_variants)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.module_id,
        data.name,
        data.prompt,
        data.negative || '',
        data.weight ?? 1.0,
        data.sort_order ?? 0,
        data.metadata || '{}',
        data.prompt_variants || '{}'
      ]
    )
    saveDatabase()
    return id
  }

  update(id: string, data: Partial<Record<string, unknown>>): void {
    const db = getDatabase()
    const sanitized = sanitizeUpdateFields(data, ALLOWED_UPDATE_FIELDS.module_items)
    const fields = Object.keys(sanitized)
    if (fields.length === 0) return
    const setClauses = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => sanitized[f])
    db.run(`UPDATE module_items SET ${setClauses} WHERE id = ?`, [...(values as string[]), id])
    saveDatabase()
  }

  delete(id: string): void {
    const db = getDatabase()
    db.run('DELETE FROM module_items WHERE id = ?', [id])
    saveDatabase()
  }

  reorder(itemIds: string[]): void {
    const db = getDatabase()
    for (let i = 0; i < itemIds.length; i++) {
      db.run('UPDATE module_items SET sort_order = ? WHERE id = ?', [i, itemIds[i]])
    }
    saveDatabase()
  }

  bulkUpdate(updates: Array<{ id: string; data: Partial<Record<string, unknown>> }>): {
    succeeded: number
    failed: number
    errors: Array<{ id: string; error: string }>
  } {
    const db = getDatabase()
    const errors: Array<{ id: string; error: string }> = []
    let succeeded = 0

    db.run('BEGIN TRANSACTION')
    try {
      for (const update of updates) {
        try {
          const sanitized = sanitizeUpdateFields(update.data, ALLOWED_UPDATE_FIELDS.module_items)
          const fields = Object.keys(sanitized)
          if (fields.length === 0) {
            errors.push({ id: update.id, error: 'No valid fields to update' })
            continue
          }
          const setClauses = fields.map((f) => `${f} = ?`).join(', ')
          const values = fields.map((f) => sanitized[f])
          db.run(`UPDATE module_items SET ${setClauses} WHERE id = ?`, [
            ...(values as string[]),
            update.id
          ])
          succeeded++
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors.push({ id: update.id, error: msg })
          log.warn(`bulkUpdate failed for item ${update.id}: ${msg}`)
        }
      }
      db.run('COMMIT')
      saveDatabase()
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }

    return { succeeded, failed: errors.length, errors }
  }
}

export class CharacterRepository {
  list(): Record<string, unknown>[] {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM characters ORDER BY name ASC')
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  get(id: string): Record<string, unknown> | null {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM characters WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return row
    }
    stmt.free()
    return null
  }

  create(data: {
    name: string
    base_prompt: string
    negative_prompt?: string
    metadata?: string
  }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO characters (id, name, base_prompt, negative_prompt, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.name, data.base_prompt, data.negative_prompt || '', data.metadata || '{}']
    )
    saveDatabase()
    return id
  }

  update(id: string, data: Partial<Record<string, unknown>>): void {
    const db = getDatabase()
    const sanitized = sanitizeUpdateFields(data, ALLOWED_UPDATE_FIELDS.characters)
    const fields = Object.keys(sanitized)
    if (fields.length === 0) return
    const setClauses = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => sanitized[f])
    db.run(`UPDATE characters SET ${setClauses} WHERE id = ?`, [...(values as string[]), id])
    saveDatabase()
  }

  delete(id: string): void {
    const db = getDatabase()
    db.run('DELETE FROM characters WHERE id = ?', [id])
    saveDatabase()
  }
}

export class BatchJobRepository {
  list(status?: string): Record<string, unknown>[] {
    const db = getDatabase()
    let query = 'SELECT * FROM batch_jobs'
    const params: unknown[] = []
    if (status) {
      query += ' WHERE status = ?'
      params.push(status)
    }
    query += ' ORDER BY sort_order ASC, created_at DESC'
    const stmt = db.prepare(query)
    if (params.length) stmt.bind(params as string[])
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  get(id: string): Record<string, unknown> | null {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM batch_jobs WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return row
    }
    stmt.free()
    return null
  }

  create(data: {
    name: string
    description?: string
    config: string
    workflow_id?: string
    total_tasks?: number
    pipeline_config?: string
    module_data_snapshot?: string
  }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO batch_jobs (id, name, description, config, workflow_id, total_tasks, pipeline_config, module_data_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.name,
        data.description || '',
        data.config,
        data.workflow_id || null,
        data.total_tasks || 0,
        data.pipeline_config || null,
        data.module_data_snapshot || null
      ]
    )
    saveDatabase()
    return id
  }

  updateStatus(id: string, status: string): void {
    const db = getDatabase()
    const extra =
      status === 'running'
        ? ", started_at = datetime('now')"
        : status === 'completed' || status === 'failed' || status === 'cancelled'
          ? ", completed_at = datetime('now')"
          : ''
    db.run(`UPDATE batch_jobs SET status = ?${extra} WHERE id = ?`, [status, id])
    saveDatabase()
  }

  updateProgress(id: string, completed: number, failed: number): void {
    const db = getDatabase()
    db.run('UPDATE batch_jobs SET completed_tasks = ?, failed_tasks = ? WHERE id = ?', [
      completed,
      failed,
      id
    ])
    saveDatabase()
  }

  delete(id: string): void {
    const db = getDatabase()
    db.run('DELETE FROM batch_jobs WHERE id = ?', [id])
    saveDatabase()
  }

  reorder(jobIds: string[]): void {
    const db = getDatabase()
    for (let i = 0; i < jobIds.length; i++) {
      db.run('UPDATE batch_jobs SET sort_order = ? WHERE id = ?', [i, jobIds[i]])
    }
    saveDatabase()
  }
}

export class BatchTaskRepository {
  listByJob(jobId: string): Record<string, unknown>[] {
    const db = getDatabase()
    const stmt = db.prepare('SELECT * FROM batch_tasks WHERE job_id = ? ORDER BY sort_order ASC')
    stmt.bind([jobId])
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  listByJobPending(jobId: string, limit: number): Record<string, unknown>[] {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT * FROM batch_tasks WHERE job_id = ? AND status NOT IN ('completed', 'cancelled') ORDER BY sort_order ASC LIMIT ?"
    )
    stmt.bind([jobId, limit])
    const results: Record<string, unknown>[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject())
    }
    stmt.free()
    return results
  }

  countByJobStatus(jobId: string): Record<string, number> {
    const db = getDatabase()
    const stmt = db.prepare(
      'SELECT status, COUNT(*) as count FROM batch_tasks WHERE job_id = ? GROUP BY status'
    )
    stmt.bind([jobId])
    const result: Record<string, number> = {}
    while (stmt.step()) {
      const row = stmt.getAsObject() as { status: string; count: number }
      result[row.status] = row.count
    }
    stmt.free()
    return result
  }

  createBulk(
    tasks: Array<{
      job_id: string
      prompt_data: string
      sort_order: number
      metadata: string
    }>
  ): void {
    const db = getDatabase()
    db.run('BEGIN TRANSACTION')
    try {
      for (const task of tasks) {
        const id = uuidv4()
        db.run(
          `INSERT INTO batch_tasks (id, job_id, prompt_data, sort_order, metadata)
           VALUES (?, ?, ?, ?, ?)`,
          [id, task.job_id, task.prompt_data, task.sort_order, task.metadata]
        )
      }
      db.run('COMMIT')
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }
    saveDatabase()
  }

  updateStatus(
    id: string,
    status: string,
    extra?: { comfyui_prompt_id?: string; result_path?: string; error_message?: string }
  ): void {
    const db = getDatabase()
    let query = 'UPDATE batch_tasks SET status = ?'
    const params: (string | null)[] = [status]

    if (extra?.comfyui_prompt_id) {
      query += ', comfyui_prompt_id = ?'
      params.push(extra.comfyui_prompt_id)
    }
    if (extra?.result_path) {
      query += ', result_path = ?'
      params.push(extra.result_path)
    }
    if (extra?.error_message) {
      query += ', error_message = ?'
      params.push(extra.error_message)
    }
    if (status === 'completed' || status === 'failed') {
      query += ", completed_at = datetime('now')"
    }
    if (status === 'retrying') {
      query += ', retry_count = retry_count + 1'
    }

    query += ' WHERE id = ?'
    params.push(id)

    db.run(query, params)
    saveDatabase()
  }

  deleteByJob(jobId: string): void {
    const db = getDatabase()
    db.run('DELETE FROM batch_tasks WHERE job_id = ?', [jobId])
    saveDatabase()
  }

  resetByJob(jobId: string): void {
    const db = getDatabase()
    db.run(
      "UPDATE batch_tasks SET status = 'pending', comfyui_prompt_id = NULL, error_message = NULL, completed_at = NULL, retry_count = 0 WHERE job_id = ?",
      [jobId]
    )
    saveDatabase()
  }

  createSingle(data: {
    job_id: string
    prompt_data: string
    sort_order: number
    metadata: string
  }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO batch_tasks (id, job_id, prompt_data, sort_order, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.job_id, data.prompt_data, data.sort_order, data.metadata]
    )
    saveDatabase()
    return id
  }

  countProcessedByJob(jobId: string): number {
    const db = getDatabase()
    const stmt = db.prepare(
      "SELECT COUNT(*) as count FROM batch_tasks WHERE job_id = ? AND status IN ('completed', 'failed', 'cancelled')"
    )
    stmt.bind([jobId])
    stmt.step()
    const count = (stmt.getAsObject() as { count: number }).count
    stmt.free()
    return count
  }

  clearPromptDataForCompleted(jobId: string): void {
    const db = getDatabase()
    db.run("UPDATE batch_tasks SET prompt_data = '{}' WHERE job_id = ? AND status = 'completed'", [
      jobId
    ])
    saveDatabase()
  }

  resetRunningTasksByJob(jobId: string): void {
    const db = getDatabase()
    db.run(
      "UPDATE batch_tasks SET status = 'pending', comfyui_prompt_id = NULL WHERE job_id = ? AND status = 'running'",
      [jobId]
    )
    saveDatabase()
  }

  cancelRemainingTasksByJob(jobId: string): void {
    const db = getDatabase()
    db.run(
      "UPDATE batch_tasks SET status = 'cancelled' WHERE job_id = ? AND status NOT IN ('completed', 'cancelled')",
      [jobId]
    )
    saveDatabase()
  }
}

export class GeneratedImageRepository {
  list(query: {
    page: number
    pageSize: number
    characterName?: string
    outfitName?: string
    emotionName?: string
    styleName?: string
    minRating?: number
    isFavorite?: boolean
    jobId?: string
    sortBy?: string
    sortOrder?: string
  }): { items: Record<string, unknown>[]; total: number } {
    const db = getDatabase()
    let whereClause = 'WHERE 1=1'
    const params: unknown[] = []

    if (query.characterName) {
      whereClause += ' AND character_name = ?'
      params.push(query.characterName)
    }
    if (query.outfitName) {
      whereClause += ' AND outfit_name = ?'
      params.push(query.outfitName)
    }
    if (query.emotionName) {
      whereClause += ' AND emotion_name = ?'
      params.push(query.emotionName)
    }
    if (query.styleName) {
      whereClause += ' AND style_name = ?'
      params.push(query.styleName)
    }
    if (query.minRating !== undefined) {
      whereClause += ' AND rating >= ?'
      params.push(query.minRating)
    }
    if (query.isFavorite !== undefined) {
      whereClause += ' AND is_favorite = ?'
      params.push(query.isFavorite ? 1 : 0)
    }
    if (query.jobId) {
      whereClause += ' AND job_id = ?'
      params.push(query.jobId)
    }

    // Count total
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM generated_images ${whereClause}`)
    if (params.length) countStmt.bind(params as string[])
    countStmt.step()
    const total = (countStmt.getAsObject() as { count: number }).count
    countStmt.free()

    // Fetch page
    const sortBy = query.sortBy || 'created_at'
    const sortOrder = query.sortOrder || 'desc'
    const offset = (query.page - 1) * query.pageSize
    const dataQuery = `SELECT * FROM generated_images ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`
    const dataParams = [...params, query.pageSize, offset]
    const stmt = db.prepare(dataQuery)
    stmt.bind(dataParams as string[])
    const items: Record<string, unknown>[] = []
    while (stmt.step()) {
      items.push(stmt.getAsObject())
    }
    stmt.free()

    return { items, total }
  }

  create(data: {
    task_id?: string
    job_id?: string
    file_path: string
    thumbnail_path?: string
    file_size?: number
    width?: number
    height?: number
    generation_params?: string
    prompt_text?: string
    negative_text?: string
    character_name?: string
    outfit_name?: string
    emotion_name?: string
    style_name?: string
  }): string {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO generated_images (id, task_id, job_id, file_path, thumbnail_path, file_size,
        width, height, generation_params, prompt_text, negative_text,
        character_name, outfit_name, emotion_name, style_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.task_id || null,
        data.job_id || null,
        data.file_path,
        data.thumbnail_path || null,
        data.file_size || null,
        data.width || null,
        data.height || null,
        data.generation_params || '{}',
        data.prompt_text || null,
        data.negative_text || null,
        data.character_name || null,
        data.outfit_name || null,
        data.emotion_name || null,
        data.style_name || null
      ]
    )
    saveDatabase()
    return id
  }

  updateRating(id: string, rating: number): void {
    const db = getDatabase()
    db.run('UPDATE generated_images SET rating = ? WHERE id = ?', [rating, id])
    saveDatabase()
  }

  updateFavorite(id: string, isFavorite: boolean): void {
    const db = getDatabase()
    db.run('UPDATE generated_images SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, id])
    saveDatabase()
  }

  delete(ids: string[]): void {
    const db = getDatabase()
    const placeholders = ids.map(() => '?').join(',')
    db.run(`DELETE FROM generated_images WHERE id IN (${placeholders})`, ids)
    saveDatabase()
  }
}
