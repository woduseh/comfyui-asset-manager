import * as fs from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  cleanupPartialOutputFiles,
  downloadTaskImages,
  type TaskImageRecord
} from '../../../../src/main/services/batch/task-output'

vi.mock('fs', async (original) => ({
  ...(await original<typeof import('fs')>()),
  writeFileSync: vi.fn((...args: Parameters<typeof fs.writeFileSync>) => actualWrite(...args))
}))
const { writeFileSync: actualWrite } = await vi.importActual<typeof import('fs')>('fs')
const directories: string[] = []
afterEach(() => {
  vi.mocked(fs.writeFileSync).mockImplementation(actualWrite)
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function fixture(): Parameters<typeof downloadTaskImages>[0] & {
  getImage: Mock<() => Promise<Buffer>>
  outputs: Record<string, { images: Array<{ filename: string; subfolder: string; type: string }> }>
} {
  const directory = fs.mkdtempSync(join(tmpdir(), 'task-output-'))
  directories.push(directory)
  return {
    outputs: { '1': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
    outputRoot: directory,
    outputDirectory: directory,
    jobConfig: {
      name: 'job',
      workflowId: 'wf',
      moduleSelections: [],
      countPerCombination: 1,
      seedMode: 'fixed' as const,
      outputFolderPattern: '{job}',
      fileNamePattern: 'image'
    },
    metadata: { combinationIndex: 0, imageIndex: 0, totalInCombination: 1 },
    promptData: { positive: '', negative: '', seed: 0 },
    promptId: 'prompt',
    taskId: 'task',
    jobId: 'job',
    getImage: vi.fn(async () => Buffer.from('complete-image')),
    target: { savedPaths: [] as string[], imageRecords: [] as TaskImageRecord[] }
  }
}

describe('task output failure boundaries', () => {
  it('tracks partially written files for cleanup when the write fails', async () => {
    const options = fixture()
    vi.mocked(fs.writeFileSync).mockImplementationOnce((path) => {
      actualWrite(path, 'partial')
      throw new Error('Injected disk full')
    })
    await expect(downloadTaskImages(options)).rejects.toThrow('Injected disk full')
    expect(cleanupPartialOutputFiles(options.target.savedPaths)).toEqual([])
    expect(fs.readdirSync(options.outputDirectory)).toEqual([])
  })

  it('cleans earlier images if downloading a later image fails', async () => {
    const options = fixture()
    options.outputs['1'].images.push({ filename: 'b.png', subfolder: '', type: 'output' })
    options.getImage
      .mockReset()
      .mockResolvedValueOnce(Buffer.from('first'))
      .mockRejectedValueOnce(new Error('download failed'))
    await expect(downloadTaskImages(options)).rejects.toThrow('download failed')
    expect(options.target.savedPaths).toHaveLength(1)
    expect(cleanupPartialOutputFiles(options.target.savedPaths)).toEqual([])
    expect(fs.readdirSync(options.outputDirectory)).toEqual([])
  })

  it('never overwrites or cleans a competing file created after path allocation', async () => {
    const options = fixture()
    const journal = { plan: (path: string) => actualWrite(path, 'user-owned'), discard: vi.fn() }
    await expect(downloadTaskImages({ ...options, journal })).rejects.toThrow()
    expect(options.target.savedPaths).toEqual([])
    cleanupPartialOutputFiles(options.target.savedPaths)
    expect(fs.readFileSync(join(options.outputDirectory, 'image.png'), 'utf8')).toBe('user-owned')
  })
})
