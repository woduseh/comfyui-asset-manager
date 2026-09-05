import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginTaskOutputJournal,
  recoverTaskOutputJournals
} from '../../../../src/main/services/batch/output-journal'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.directory } }))
beforeEach(() => {
  state.directory = mkdtempSync(join(tmpdir(), 'output-journal-'))
})
afterEach(() => {
  rmSync(state.directory, { recursive: true, force: true })
})

describe('output journal crash recovery', () => {
  it('keeps output and unresolved intent when the process exits before its DB snapshot is saved', async () => {
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run('CREATE TABLE images (path TEXT)')
    const dbPath = join(state.directory, 'db.sqlite')
    writeFileSync(dbPath, db.export())
    const path = join(state.directory, 'image.png')
    const journal = beginTaskOutputJournal('task', 'prompt')
    journal.plan(path)
    writeFileSync(path, 'image')
    db.run('INSERT INTO images VALUES (?)', [path])
    // Simulate process exit: reopen only the snapshot that reached disk.
    db.close()
    const recovered = new SQL.Database(readFileSync(dbPath))
    const pending = recoverTaskOutputJournals((entry) =>
      entry.paths.every(
        (file) => recovered.exec('SELECT path FROM images WHERE path = ?', [file]).length > 0
      )
    )
    expect(pending).toEqual([{ taskId: 'task', promptId: 'prompt', paths: [path] }])
    expect(readFileSync(path, 'utf8')).toBe('image')
    recovered.close()
  })

  it('removes only the journal after a durable DB commit, preserving images', async () => {
    const path = join(state.directory, 'image.png')
    beginTaskOutputJournal('task', 'prompt').plan(path)
    writeFileSync(path, 'image')
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run('CREATE TABLE images (path TEXT)')
    db.run('INSERT INTO images VALUES (?)', [path])
    const dbPath = join(state.directory, 'db.sqlite')
    writeFileSync(dbPath, db.export())
    db.close()
    const recovered = new SQL.Database(readFileSync(dbPath))
    expect(
      recoverTaskOutputJournals((entry) =>
        entry.paths.every(
          (file) => recovered.exec('SELECT path FROM images WHERE path = ?', [file]).length > 0
        )
      )
    ).toEqual([])
    recovered.close()
    expect(readFileSync(path, 'utf8')).toBe('image')
    expect(readdirSync(join(state.directory, 'data', 'task-output-journals'))).toEqual([])
  })

  it('preserves missing-file intent and temporary snapshots for reconciliation', () => {
    const path = join(state.directory, 'never-written.png')
    beginTaskOutputJournal('task', 'prompt').plan(path)
    const directory = join(state.directory, 'data', 'task-output-journals')
    const name = readdirSync(directory)[0]
    writeFileSync(
      join(directory, `${name}.tmp`),
      JSON.stringify({
        taskId: 'task',
        promptId: 'prompt',
        paths: [path, join(state.directory, 'next.png')]
      })
    )
    expect(recoverTaskOutputJournals(() => false)).toHaveLength(2)
  })

  it('rejects corrupt journal data without deleting any images', () => {
    const path = join(state.directory, 'image.png')
    beginTaskOutputJournal('task', 'prompt').plan(path)
    writeFileSync(path, 'image')
    const directory = join(state.directory, 'data', 'task-output-journals')
    writeFileSync(join(directory, readdirSync(directory)[0]), '{invalid')
    expect(() => recoverTaskOutputJournals(() => false)).toThrow('Task output journal')
    expect(readFileSync(path, 'utf8')).toBe('image')
  })

  it('discards intent after successful in-process cleanup', () => {
    const journal = beginTaskOutputJournal('../task', 'prompt')
    journal.plan(join(state.directory, 'image.png'))
    journal.discard()
    expect(recoverTaskOutputJournals(() => false)).toEqual([])
  })
})
