import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, promises as fsPromises } from 'fs'
import { tmpdir } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'

const electronState = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataPath
  }
}))

vi.mock('@main/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

type DatabaseModule = typeof import('@main/services/database')

let databaseModule: DatabaseModule
let testDirectory = ''

function getRows(): string[] {
  const result = databaseModule
    .getDatabase()
    .exec('SELECT value FROM transaction_test ORDER BY value')
  return (result[0]?.values ?? []).map((row) => String(row[0]))
}

beforeEach(async () => {
  vi.resetModules()
  testDirectory = mkdtempSync(join(tmpdir(), 'comfyui-asset-manager-db-'))
  electronState.userDataPath = testDirectory
  databaseModule = await import('@main/services/database')
  await databaseModule.initDatabase()
  databaseModule.getDatabase().run('CREATE TABLE transaction_test (value TEXT NOT NULL)')
  await databaseModule.flushDatabase()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await databaseModule.closeDatabase()

  const resolvedDirectory = resolve(testDirectory)
  const resolvedTempRoot = resolve(tmpdir())
  const relativeDirectory = relative(resolvedTempRoot, resolvedDirectory)
  const isOutsideTempRoot =
    relativeDirectory === '' ||
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  if (isOutsideTempRoot || !basename(resolvedDirectory).startsWith('comfyui-asset-manager-db-')) {
    throw new Error(`Refusing to remove non-temporary test directory: ${resolvedDirectory}`)
  }
  rmSync(resolvedDirectory, { recursive: true, force: true })
})

describe('database transactions', () => {
  it('commits mutations and schedules one save for nested work', async () => {
    const renameSpy = vi.spyOn(fsPromises, 'rename')

    databaseModule.withTransaction(() => {
      databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('outer')")
      databaseModule.saveDatabase()
      databaseModule.withTransaction(() => {
        databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('inner')")
        databaseModule.saveDatabase()
      })
    })

    await databaseModule.flushDatabase()

    expect(getRows()).toEqual(['inner', 'outer'])
    expect(renameSpy).toHaveBeenCalledTimes(1)
  })

  it('rolls back the complete outer transaction without scheduling a save', async () => {
    const renameSpy = vi.spyOn(fsPromises, 'rename')

    expect(() =>
      databaseModule.withTransaction(() => {
        databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('rolled-back')")
        databaseModule.saveDatabase()
        throw new Error('stop')
      })
    ).toThrow('stop')

    await databaseModule.flushDatabase()

    expect(getRows()).toEqual([])
    expect(renameSpy).not.toHaveBeenCalled()
  })

  it('rolls back only the failed nested savepoint when the caller recovers', () => {
    databaseModule.withTransaction(() => {
      databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('before')")
      try {
        databaseModule.withTransaction(() => {
          databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('nested')")
          throw new Error('nested failure')
        })
      } catch (error) {
        expect((error as Error).message).toBe('nested failure')
      }
      databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('after')")
    })

    expect(getRows()).toEqual(['after', 'before'])
  })

  it('rejects a flush before its transaction commits', async () => {
    let prematureFlush: Promise<void> | undefined
    databaseModule.withTransaction(() => {
      databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('uncommitted')")
      prematureFlush = databaseModule.flushDatabase()
    })

    await expect(prematureFlush).rejects.toThrow('uncommitted transaction')
    await databaseModule.flushDatabase()
  })
})

describe('database query indexes', () => {
  it('uses indexed gallery authorization, ordering, and job status counts', async () => {
    const { GeneratedImageRepository, BatchJobRepository } =
      await import('@main/services/database/repositories')
    const images = new GeneratedImageRepository()
    const jobs = new BatchJobRepository()
    const jobId = jobs.create({ name: 'Indexed job', config: '{}' })
    const imageId = images.create({
      job_id: jobId,
      file_path: '/archive/original.png',
      thumbnail_path: '/archive/thumbnail.png'
    })
    const db = databaseModule.getDatabase()
    db.run(
      "INSERT INTO batch_tasks (id, job_id, status, prompt_data) VALUES ('task', ?, 'uncertain', '{}')",
      [jobId]
    )
    const prepareSpy = vi.spyOn(db, 'prepare')

    expect(images.hasTrackedAssetPath(['/missing.png', '/archive/original.png'])).toBe(true)
    expect(images.hasTrackedAssetPath('/archive/thumbnail.png')).toBe(true)
    expect(images.hasTrackedAssetPath('/unregistered.png')).toBe(false)
    expect(images.list({ page: 1, pageSize: 20 }).items[0].id).toBe(imageId)
    expect(jobs.list()[0].uncertain_tasks).toBe(1)

    // Check the repository's actual SQL so an accidental query change cannot bypass the indexes.
    const queries = prepareSpy.mock.calls.map(([sql]) => String(sql))
    prepareSpy.mockRestore()
    const plan = (sql: string): string =>
      db
        .exec(`EXPLAIN QUERY PLAN ${sql}`)[0]
        .values.map((row) => String(row[3]))
        .join('\n')
    const authorizationPlan = plan(queries.find((sql) => sql.startsWith('SELECT 1'))!)
    expect(authorizationPlan).toContain('idx_generated_images_file_path')
    expect(authorizationPlan).toContain('idx_generated_images_thumbnail_path')
    expect(authorizationPlan).not.toContain('SCAN generated_images')
    const galleryPlan = plan(
      queries.find((sql) => sql.startsWith('SELECT * FROM generated_images'))!
    )
    expect(galleryPlan).toContain('idx_generated_images_created_at')
    expect(galleryPlan).not.toContain('USE TEMP B-TREE')
    const jobsPlan = plan(queries.find((sql) => sql.startsWith('SELECT batch_jobs.*'))!)
    expect(jobsPlan).toContain('COVERING INDEX idx_batch_tasks_job_status')
  })

  it('adds query indexes to an existing database while preserving registered images', async () => {
    const indexes = [
      'idx_generated_images_file_path',
      'idx_generated_images_thumbnail_path',
      'idx_generated_images_created_at',
      'idx_batch_tasks_job_status'
    ]
    const db = databaseModule.getDatabase()
    for (const index of indexes) db.run(`DROP INDEX ${index}`)
    db.run(
      "INSERT INTO generated_images (id, file_path, thumbnail_path) VALUES ('existing', '/original.png', '/thumbnail.png')"
    )
    await databaseModule.closeDatabase()
    await databaseModule.initDatabase()

    const reopened = databaseModule.getDatabase()
    const restoredIndexes = reopened
      .exec("SELECT name FROM sqlite_master WHERE type = 'index'")[0]
      .values.map(([name]) => name)
    expect(restoredIndexes).toEqual(expect.arrayContaining(indexes))
    expect(
      reopened.exec('SELECT id, file_path, thumbnail_path FROM generated_images')[0].values
    ).toEqual([['existing', '/original.png', '/thumbnail.png']])
  })
})

describe('database persistence queue', () => {
  it('serializes writes and persists a newer revision after an in-flight write', async () => {
    const originalRename = fsPromises.rename.bind(fsPromises)
    let releaseFirstRename: (() => void) | undefined
    let notifyFirstRename: (() => void) | undefined
    const firstRenameStarted = new Promise<void>((resolveStarted) => {
      notifyFirstRename = resolveStarted
    })
    const firstRenameGate = new Promise<void>((resolveGate) => {
      releaseFirstRename = resolveGate
    })
    const renameSpy = vi
      .spyOn(fsPromises, 'rename')
      .mockImplementationOnce(async (oldPath, newPath) => {
        notifyFirstRename?.()
        await firstRenameGate
        await originalRename(oldPath, newPath)
      })

    databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('first')")
    databaseModule.saveDatabase()
    const flushPromise = databaseModule.flushDatabase()
    await firstRenameStarted

    databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('second')")
    databaseModule.saveDatabase()
    releaseFirstRename?.()
    await flushPromise

    expect(renameSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous database file when every atomic rename attempt fails', async () => {
    const databasePath = join(testDirectory, 'data', 'comfyui_asset_manager.db')
    const previousSnapshot = readFileSync(databasePath)
    const renameError = Object.assign(new Error('locked'), { code: 'EPERM' })
    const renameSpy = vi.spyOn(fsPromises, 'rename').mockRejectedValue(renameError)

    databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('unsaved')")
    databaseModule.saveDatabase()
    await expect(databaseModule.flushDatabase()).rejects.toThrow('locked')

    expect(renameSpy).toHaveBeenCalledTimes(4)
    expect(readFileSync(databasePath)).toEqual(previousSnapshot)
  })

  it('persists the failed revision when an explicit retry succeeds', async () => {
    const databasePath = join(testDirectory, 'data', 'comfyui_asset_manager.db')
    const renameSpy = vi
      .spyOn(fsPromises, 'rename')
      .mockRejectedValueOnce(new Error('injected replacement failure'))

    databaseModule.withTransaction(() => {
      databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('retry-me')")
    })
    await expect(databaseModule.flushDatabase()).rejects.toThrow('injected replacement failure')
    await databaseModule.flushDatabase()

    const { default: initSqlJs } = await import('sql.js')
    const SQL = await initSqlJs()
    const persisted = new SQL.Database(readFileSync(databasePath))
    try {
      expect(persisted.exec('SELECT value FROM transaction_test')[0].values).toEqual([['retry-me']])
      expect(renameSpy).toHaveBeenCalledTimes(2)
    } finally {
      persisted.close()
    }
  })

  it('retains background retries after an explicit flush rejects', async () => {
    const originalRename = fsPromises.rename.bind(fsPromises)
    let notifyReplacement: (() => void) | undefined
    const replaced = new Promise<void>((resolveReplacement) => {
      notifyReplacement = resolveReplacement
    })
    const renameSpy = vi
      .spyOn(fsPromises, 'rename')
      .mockRejectedValueOnce(new Error('temporary replacement failure'))
      .mockImplementationOnce(async (oldPath, newPath) => {
        await originalRename(oldPath, newPath)
        notifyReplacement?.()
      })
    databaseModule.withTransaction(() => {
      databaseModule.getDatabase().run("INSERT INTO transaction_test VALUES ('background-retry')")
    })

    await expect(databaseModule.flushDatabase()).rejects.toThrow('temporary replacement failure')
    await replaced
    await databaseModule.flushDatabase()

    expect(renameSpy).toHaveBeenCalledTimes(2)
    await databaseModule.closeDatabase()
    await databaseModule.initDatabase()
    expect(getRows()).toEqual(['background-retry'])
  })
})
