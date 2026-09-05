import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  promises as fs,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import {
  DB_RENAME_RETRY_DELAYS_MS,
  DB_SAVE_DEBOUNCE_BATCH_MS,
  DB_SAVE_DEBOUNCE_MS,
  DB_SAVE_RETRY_DELAYS_MS
} from '../../constants'
import log from '../../logger'

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null
let writePromise: Promise<void> | null = null
let requestedSaveRevision = 0
let persistedSaveRevision = 0
let consecutiveSaveFailures = 0
let lastSaveError: unknown
let batchMode = false
let isClosing = false
let transactionDepth = 0
let savepointCounter = 0

const SQLITE_OK = 'ok'

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'data', 'comfyui_asset_manager.db')
}

function getTempDbPath(): string {
  return `${dbPath}.tmp`
}

function isRetryableRenameError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  return ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code))
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function renameDatabaseFile(tempPath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tempPath, dbPath)
      return
    } catch (error) {
      const retryDelay = DB_RENAME_RETRY_DELAYS_MS[attempt]
      if (retryDelay === undefined || !isRetryableRenameError(error)) {
        throw error
      }
      await wait(retryDelay)
    }
  }
}

async function writeDatabaseSnapshot(buffer: Uint8Array): Promise<void> {
  const tempPath = getTempDbPath()
  const file = await fs.open(tempPath, 'w')
  try {
    await file.writeFile(buffer)
    await file.sync()
  } finally {
    await file.close()
  }
  await renameDatabaseFile(tempPath)
}

function writeDatabaseSnapshotSync(buffer: Uint8Array): void {
  const tempPath = getTempDbPath()
  const descriptor = openSync(tempPath, 'w')
  try {
    writeFileSync(descriptor, buffer)
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(tempPath, dbPath)
}

function recoverTemporaryDatabase(SQL: Awaited<ReturnType<typeof initSqlJs>>): void {
  const tempPath = getTempDbPath()
  if (!existsSync(tempPath)) return

  if (existsSync(dbPath)) {
    try {
      unlinkSync(tempPath)
    } catch (error) {
      log.warn('[Database] Failed to remove a stale temporary database:', error)
    }
    return
  }

  let temporaryDatabase: SqlJsDatabase | null = null
  try {
    temporaryDatabase = new SQL.Database(readFileSync(tempPath))
    const check = temporaryDatabase.exec('PRAGMA quick_check;')
    const result = check[0]?.values[0]?.[0]
    if (result !== SQLITE_OK) {
      throw new Error(`SQLite quick_check returned ${String(result)}`)
    }
    temporaryDatabase.close()
    temporaryDatabase = null
    renameSync(tempPath, dbPath)
    log.info('[Database] Recovered database from a temporary snapshot')
  } catch (error) {
    temporaryDatabase?.close()
    log.warn('[Database] Discarding an invalid temporary database snapshot:', error)
    try {
      unlinkSync(tempPath)
    } catch (cleanupError) {
      log.warn('[Database] Failed to remove the invalid temporary database:', cleanupError)
    }
  }
}

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (db) return db

  const SQL = await initSqlJs()
  dbPath = getDbPath()
  isClosing = false
  requestedSaveRevision = 0
  persistedSaveRevision = 0
  consecutiveSaveFailures = 0
  lastSaveError = undefined
  transactionDepth = 0
  savepointCounter = 0

  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  recoverTemporaryDatabase(SQL)

  const database = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()

  try {
    database.run('PRAGMA journal_mode = WAL;')
    database.run('PRAGMA foreign_keys = ON;')
    createTables(database)
  } catch (error) {
    database.close()
    throw error
  }

  db = database
  saveDatabase()

  return db
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function saveDatabase(): void {
  if (!db || isClosing) return
  if (transactionDepth > 0) return

  requestDatabaseSave()
}

function requestDatabaseSave(delayMs?: number): void {
  if (!db || isClosing) return

  requestedSaveRevision++
  if (writePromise) return

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  const debounceMs = delayMs ?? (batchMode ? DB_SAVE_DEBOUNCE_BATCH_MS : DB_SAVE_DEBOUNCE_MS)

  saveTimer = setTimeout(() => {
    saveTimer = null
    void ensureSaveLoop()
  }, debounceMs)
}

export function setBatchMode(enabled: boolean): void {
  batchMode = enabled
}

function scheduleSaveRetry(): void {
  if (!db || isClosing || saveTimer) return
  const retryDelay = DB_SAVE_RETRY_DELAYS_MS[consecutiveSaveFailures - 1]
  if (retryDelay === undefined) return

  saveTimer = setTimeout(() => {
    saveTimer = null
    void ensureSaveLoop()
  }, retryDelay)
}

function ensureSaveLoop(): Promise<void> {
  if (writePromise) return writePromise
  if (!db || persistedSaveRevision >= requestedSaveRevision) {
    return Promise.resolve()
  }

  writePromise = (async () => {
    while (db && persistedSaveRevision < requestedSaveRevision) {
      const snapshotRevision = requestedSaveRevision
      try {
        // sql.js exports an owned byte array; fs can write it without copying the entire DB.
        const buffer = db.export()
        await writeDatabaseSnapshot(buffer)
        persistedSaveRevision = snapshotRevision
        consecutiveSaveFailures = 0
        lastSaveError = undefined
      } catch (error) {
        consecutiveSaveFailures++
        lastSaveError = error
        log.error('[Database] Failed to persist database snapshot:', error)
        scheduleSaveRetry()
        return
      }
    }
  })().finally(() => {
    writePromise = null
  })

  return writePromise
}

export async function flushDatabase(): Promise<void> {
  if (!db) return
  if (transactionDepth > 0) {
    throw new Error('Cannot flush database inside an uncommitted transaction')
  }
  const requiredRevision = requestedSaveRevision
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await ensureSaveLoop()
  if (persistedSaveRevision < requiredRevision) {
    throw lastSaveError ?? new Error('Database snapshot was not persisted')
  }
}

export function saveDatabaseSync(): void {
  if (!db) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const snapshotRevision = ++requestedSaveRevision
  writeDatabaseSnapshotSync(db.export())
  persistedSaveRevision = snapshotRevision
  consecutiveSaveFailures = 0
  lastSaveError = undefined
}

export async function closeDatabase(): Promise<void> {
  if (!db) return

  isClosing = true
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  let closeError: unknown
  try {
    if (writePromise) {
      await writePromise
    }
    saveDatabaseSync()
  } catch (error) {
    closeError = error
    log.error('[Database] Final database flush failed:', error)
  } finally {
    db.close()
    db = null
    writePromise = null
    transactionDepth = 0
    savepointCounter = 0
  }

  if (closeError) {
    throw closeError
  }
}

export function withTransaction<T>(fn: () => T): T {
  const database = getDatabase()
  const isOutermost = transactionDepth === 0
  const savepointName = `app_tx_${++savepointCounter}`
  let committed = false

  database.run(isOutermost ? 'BEGIN TRANSACTION' : `SAVEPOINT ${savepointName}`)
  transactionDepth++

  try {
    const result = fn()
    database.run(isOutermost ? 'COMMIT' : `RELEASE SAVEPOINT ${savepointName}`)
    committed = true
    return result
  } catch (error) {
    try {
      if (isOutermost) {
        database.run('ROLLBACK')
      } else {
        database.run(`ROLLBACK TO SAVEPOINT ${savepointName}`)
        database.run(`RELEASE SAVEPOINT ${savepointName}`)
      }
    } catch (rollbackError) {
      log.warn('[Database] Transaction rollback failed:', rollbackError)
    }
    throw error
  } finally {
    transactionDepth--
    if (isOutermost && committed) {
      requestDatabaseSave()
    }
  }
}

function addColumnIfMissing(
  database: SqlJsDatabase,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.exec(`PRAGMA table_info(${table})`)[0].values
  if (!columns.some(([, name]) => name === column)) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function createTables(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      category    TEXT NOT NULL DEFAULT 'generation',
      api_json    TEXT NOT NULL,
      ui_json     TEXT,
      variables   TEXT NOT NULL DEFAULT '[]',
      thumbnail   BLOB,
      created_at  DATETIME DEFAULT (datetime('now')),
      updated_at  DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS workflow_variables (
      id           TEXT PRIMARY KEY,
      workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      node_id      TEXT NOT NULL,
      field_name   TEXT NOT NULL,
      display_name TEXT NOT NULL,
      var_type     TEXT NOT NULL DEFAULT 'text',
      default_val  TEXT,
      description  TEXT,
      role         TEXT NOT NULL DEFAULT 'custom'
    );
  `)

  addColumnIfMissing(database, 'workflow_variables', 'role', "TEXT NOT NULL DEFAULT 'custom'")

  database.run(`
    CREATE TABLE IF NOT EXISTS prompt_modules (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      description TEXT DEFAULT '',
      is_template INTEGER DEFAULT 0,
      parent_id   TEXT REFERENCES prompt_modules(id),
      created_at  DATETIME DEFAULT (datetime('now')),
      updated_at  DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS module_items (
      id               TEXT PRIMARY KEY,
      module_id        TEXT NOT NULL REFERENCES prompt_modules(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      prompt           TEXT NOT NULL,
      negative         TEXT DEFAULT '',
      weight           REAL DEFAULT 1.0,
      sort_order       INTEGER DEFAULT 0,
      metadata         TEXT DEFAULT '{}',
      thumbnail        BLOB,
      enabled          INTEGER DEFAULT 1,
      prompt_variants  TEXT DEFAULT '{}'
    );
  `)

  addColumnIfMissing(database, 'module_items', 'prompt_variants', "TEXT DEFAULT '{}'")

  database.run(`
    CREATE TABLE IF NOT EXISTS characters (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      base_prompt     TEXT NOT NULL,
      negative_prompt TEXT DEFAULT '',
      thumbnail       BLOB,
      metadata        TEXT DEFAULT '{}',
      created_at      DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      status          TEXT DEFAULT 'draft',
      config          TEXT NOT NULL,
      workflow_id     TEXT REFERENCES workflows(id),
      total_tasks     INTEGER DEFAULT 0,
      completed_tasks INTEGER DEFAULT 0,
      failed_tasks    INTEGER DEFAULT 0,
      pipeline_config TEXT,
      created_at      DATETIME DEFAULT (datetime('now')),
      started_at      DATETIME,
      completed_at    DATETIME
    );
  `)

  addColumnIfMissing(database, 'batch_jobs', 'module_data_snapshot', 'TEXT')
  addColumnIfMissing(database, 'batch_jobs', 'sort_order', 'INTEGER DEFAULT 0')

  database.run(`
    CREATE TABLE IF NOT EXISTS batch_tasks (
      id                TEXT PRIMARY KEY,
      job_id            TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
      status            TEXT DEFAULT 'pending',
      prompt_data       TEXT NOT NULL,
      comfyui_prompt_id TEXT,
      result_path       TEXT,
      error_message     TEXT,
      retry_count       INTEGER DEFAULT 0,
      sort_order        INTEGER DEFAULT 0,
      metadata          TEXT DEFAULT '{}',
      created_at        DATETIME DEFAULT (datetime('now')),
      completed_at      DATETIME
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS generated_images (
      id                TEXT PRIMARY KEY,
      task_id           TEXT REFERENCES batch_tasks(id),
      job_id            TEXT REFERENCES batch_jobs(id),
      file_path         TEXT NOT NULL,
      thumbnail_path    TEXT,
      file_size         INTEGER,
      width             INTEGER,
      height            INTEGER,
      generation_params TEXT DEFAULT '{}',
      prompt_text       TEXT,
      negative_text     TEXT,
      rating            INTEGER DEFAULT 0,
      is_favorite       INTEGER DEFAULT 0,
      tags              TEXT DEFAULT '[]',
      character_name    TEXT,
      outfit_name       TEXT,
      emotion_name      TEXT,
      style_name        TEXT,
      created_at        DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      steps       TEXT NOT NULL,
      created_at  DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS presets (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      type        TEXT NOT NULL,
      config      TEXT NOT NULL,
      created_at  DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS saved_seeds (
      id             TEXT PRIMARY KEY,
      seed           INTEGER NOT NULL,
      description    TEXT DEFAULT '',
      source_task_id TEXT REFERENCES batch_tasks(id),
      tags           TEXT DEFAULT '[]',
      created_at     DATETIME DEFAULT (datetime('now'))
    );
  `)

  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Create indexes
  database.run('CREATE INDEX IF NOT EXISTS idx_module_items_module ON module_items(module_id);')
  database.run('CREATE INDEX IF NOT EXISTS idx_batch_tasks_job ON batch_tasks(job_id);')
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_batch_tasks_job_status ON batch_tasks(job_id, status);'
  )
  // Periodic cleanup should visit only completed tasks that still retain prompt data.
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_batch_tasks_prompt_cleanup ON batch_tasks(job_id, status)
     WHERE status = 'completed' AND prompt_data != '{}';`
  )
  database.run('CREATE INDEX IF NOT EXISTS idx_generated_images_job ON generated_images(job_id);')
  // Asset authorization runs for every image request, including paths outside the output root.
  // Both OR branches need an index to avoid scanning the entire gallery for each request.
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_generated_images_file_path ON generated_images(file_path);'
  )
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_generated_images_thumbnail_path ON generated_images(thumbnail_path);'
  )
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_generated_images_created_at ON generated_images(created_at);'
  )
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_generated_images_character ON generated_images(character_name);'
  )
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_generated_images_favorite ON generated_images(is_favorite);'
  )
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_generated_images_rating ON generated_images(rating);'
  )

  // Insert default settings
  database.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('comfyui_host', 'localhost'),
      ('comfyui_port', '8188'),
      ('output_directory', ''),
      ('language', 'ko'),
      ('theme', 'dark'),
      ('output_pattern', '{job}/{character}/{outfit}/{emotion}'),
      ('filename_pattern', '{character}_{outfit}_{emotion}_{index}'),
      ('max_retries', '3'),
      ('auto_save_interval', '5000'),
      ('mcp_auth_required', 'true');
  `)
}
