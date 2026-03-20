import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { DB_SAVE_DEBOUNCE_MS } from '../../constants'

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'data', 'comfyui_asset_manager.db')
}

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (db) return db

  const SQL = await initSqlJs()
  dbPath = getDbPath()

  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode = WAL;')
  db.run('PRAGMA foreign_keys = ON;')

  createTables(db)
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
  if (!db) return

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    if (!db) return
    const data = db.export()
    const buffer = Buffer.from(data)
    writeFileSync(dbPath, buffer)
    saveTimer = null
  }, DB_SAVE_DEBOUNCE_MS)
}

export function saveDatabaseSync(): void {
  if (!db) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(dbPath, buffer)
}

export function closeDatabase(): void {
  if (db) {
    saveDatabaseSync()
    db.close()
    db = null
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

  // Migration: add role column for existing databases
  try {
    database.run(`ALTER TABLE workflow_variables ADD COLUMN role TEXT NOT NULL DEFAULT 'custom'`)
  } catch {
    /* Column already exists */
  }

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

  // Migration: add prompt_variants column for existing databases
  try {
    database.run(`ALTER TABLE module_items ADD COLUMN prompt_variants TEXT DEFAULT '{}'`)
  } catch {
    /* Column already exists */
  }

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

  // Migration: add module_data_snapshot column for lazy task expansion
  try {
    database.run(`ALTER TABLE batch_jobs ADD COLUMN module_data_snapshot TEXT`)
  } catch {
    /* Column already exists */
  }

  // Migration: add sort_order column for batch_jobs
  try {
    database.run(`ALTER TABLE batch_jobs ADD COLUMN sort_order INTEGER DEFAULT 0`)
  } catch {
    /* Column already exists */
  }

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
  database.run('CREATE INDEX IF NOT EXISTS idx_generated_images_job ON generated_images(job_id);')
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
      ('auto_save_interval', '5000');
  `)
}
