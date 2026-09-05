import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { MAX_IMPORT_FILE_SIZE_BYTES } from '../../../../src/main/constants'
import { parseModuleItemsFile } from '../../../../src/main/services/mcp/file-parser'
import { writeModuleItemsFile } from '../../../../src/main/services/mcp/file-serializer'

vi.mock('fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs')>()) }))

let directory = ''
const items = [{ name: 'Alice', prompt: 'portrait, blue_eyes' }]

beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'comfyui-module-file-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  const target = resolve(directory)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('comfyui-module-file-'))
    throw new Error(`Refusing to remove non-temporary directory: ${target}`)
  fs.rmSync(target, { recursive: true, force: true })
})

describe('MCP module file access', () => {
  it('preserves relative paths and dot-segment resolution when exporting and importing', () => {
    const filePath = join(directory, 'items.json')
    const dottedPath = `${directory}${sep}unused${sep}..${sep}items.json`
    const result = writeModuleItemsFile(items, relative(process.cwd(), dottedPath))
    expect(result).toEqual({
      filePath,
      format: 'json',
      size: fs.statSync(filePath).size
    })
    expect(parseModuleItemsFile(dottedPath)).toMatchObject({ items, errors: [], format: 'json' })
    expect(parseModuleItemsFile(relative(process.cwd(), filePath))).toMatchObject({
      items,
      errors: []
    })
  })

  it('preserves an existing destination and its actionable error message', () => {
    const filePath = join(directory, 'items.json')
    fs.writeFileSync(filePath, 'existing user content')
    expect(() => writeModuleItemsFile(items, filePath)).toThrow(
      `File already exists: ${filePath}. Remove it first or choose a different path.`
    )
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('existing user content')
  })

  it('preserves a destination created after the existence check', () => {
    const filePath = join(directory, 'items.json')
    const existsSync = fs.existsSync
    vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
      if (path === filePath) {
        fs.writeFileSync(filePath, 'created by another writer')
        return false
      }
      return existsSync(path)
    })

    expect(() => writeModuleItemsFile(items, filePath)).toThrow(
      `File already exists: ${filePath}. Remove it first or choose a different path.`
    )
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('created by another writer')
  })

  it('propagates other write failures without reporting a successful export', () => {
    const filePath = join(directory, 'items.json')
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw failure
    })
    expect(() => writeModuleItemsFile(items, filePath)).toThrow(failure)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('retains missing-file, directory, and import-size checks', () => {
    expect(() => parseModuleItemsFile(join(directory, 'missing.json'))).toThrow('File not found')
    expect(() => parseModuleItemsFile(directory, 'json')).toThrow('Path is not a file')
    const filePath = join(directory, 'oversized.json')
    fs.writeFileSync(filePath, Buffer.alloc(MAX_IMPORT_FILE_SIZE_BYTES + 1))
    expect(() => parseModuleItemsFile(filePath)).toThrow('File too large')
  })

  it('retains format detection and missing export-directory errors', () => {
    expect(() => writeModuleItemsFile(items, join(directory, 'items.unknown'))).toThrow(
      'Cannot detect format'
    )
    expect(() => writeModuleItemsFile(items, join(directory, 'missing', 'items.json'))).toThrow(
      'Directory does not exist'
    )
    const filePath = join(directory, 'explicit.unknown')
    expect(writeModuleItemsFile(items, filePath, 'json').format).toBe('json')
    expect(parseModuleItemsFile(filePath, 'json').items).toEqual(items)
  })
})
