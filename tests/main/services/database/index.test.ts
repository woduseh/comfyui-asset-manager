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
    await databaseModule.flushDatabase()

    expect(renameSpy).toHaveBeenCalledTimes(4)
    expect(readFileSync(databasePath)).toEqual(previousSnapshot)
  })
})
