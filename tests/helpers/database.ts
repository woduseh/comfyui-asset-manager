import type { Database } from 'sql.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestDatabase {
  db: Database
  database: typeof import('@main/services/database')
  directory: string
  close(): Promise<void>
}

/** Use the production schema, writer and transactions; mock only Electron's userData path. */
export async function openTestDatabase(
  setUserDataPath: (path: string) => void
): Promise<TestDatabase> {
  const directory = mkdtempSync(join(tmpdir(), 'comfyui-test-db-'))
  setUserDataPath(directory)
  const database = await import('@main/services/database')
  try {
    const db = await database.initDatabase()
    await database.flushDatabase()
    return {
      db,
      database,
      directory,
      async close(): Promise<void> {
        try {
          await database.closeDatabase()
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      }
    }
  } catch (error) {
    await database.closeDatabase()
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
