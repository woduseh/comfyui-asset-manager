import { app } from 'electron'
import { randomUUID } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { isAbsolute, join } from 'path'
import { isJsonObject } from '@shared/safe-json'
import { parseRequiredJson } from './queue-utils'

export interface TaskOutputJournalEntry {
  taskId: string
  promptId: string
  paths: string[]
}

export interface TaskOutputJournal {
  plan(path: string): void
  discard(): void
}

function journalDirectory(): string {
  return join(app.getPath('userData'), 'data', 'task-output-journals')
}

function isEntry(value: unknown): value is TaskOutputJournalEntry {
  return (
    isJsonObject(value) &&
    typeof value.taskId === 'string' &&
    typeof value.promptId === 'string' &&
    Array.isArray(value.paths) &&
    value.paths.every((path) => typeof path === 'string' && isAbsolute(path))
  )
}

/** Persist intent before touching image files. Recovery never deletes paths from this journal. */
export function beginTaskOutputJournal(taskId: string, promptId: string): TaskOutputJournal {
  const directory = journalDirectory()
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${randomUUID()}.json`)
  const entry: TaskOutputJournalEntry = { taskId, promptId, paths: [] }
  return {
    plan(outputPath) {
      if (!isAbsolute(outputPath)) throw new Error('Output journal requires an absolute path')
      entry.paths.push(outputPath)
      const temporary = `${path}.tmp`
      const fd = openSync(temporary, 'w')
      try {
        writeFileSync(fd, JSON.stringify(entry))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, path)
    },
    discard() {
      for (const candidate of [path, `${path}.tmp`]) {
        if (existsSync(candidate)) unlinkSync(candidate)
      }
    }
  }
}

/** Leave uncommitted output intact for explicit reconciliation; do not infer remote execution. */
export function recoverTaskOutputJournals(
  isCommitted: (entry: TaskOutputJournalEntry) => boolean
): TaskOutputJournalEntry[] {
  const directory = journalDirectory()
  if (!existsSync(directory)) return []
  const unresolved: TaskOutputJournalEntry[] = []
  for (const name of readdirSync(directory)) {
    // Temporary snapshots may describe a newer intent than the last successful rename.
    if (!/^[0-9a-f-]+\.json(?:\.tmp)?$/i.test(name)) continue
    const path = join(directory, name)
    const entry = parseRequiredJson(
      readFileSync(path, 'utf8'),
      'Task output journal',
      isEntry,
      'Invalid task output journal'
    )
    if (isCommitted(entry)) unlinkSync(path)
    else unresolved.push(entry)
  }
  return unresolved
}
