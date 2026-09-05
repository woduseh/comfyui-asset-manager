import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { MAX_WORKFLOW_FILE_SIZE_BYTES } from '../../../../src/main/constants'
import { importWorkflowFromSelectedPath } from '../../../../src/main/services/comfyui/workflow-import'

function makeWorkflow(): string {
  return JSON.stringify({
    '1': {
      class_type: 'KSampler',
      inputs: { seed: 1, steps: 20, cfg: 7 },
      _meta: { title: 'Sampler' }
    }
  })
}

type WorkflowImportRepository = Parameters<typeof importWorkflowFromSelectedPath>[1]

function makeRepository(): {
  create: Mock<WorkflowImportRepository['create']>
  setVariables: Mock<WorkflowImportRepository['setVariables']>
} {
  return {
    create: vi.fn<WorkflowImportRepository['create']>(() => 'workflow-id'),
    setVariables: vi.fn<WorkflowImportRepository['setVariables']>()
  }
}

describe('importWorkflowFromSelectedPath', () => {
  it('imports a selected API workflow atomically', () => {
    const repository = makeRepository()
    const transactionStarted = vi.fn()
    const filePath = resolve('fixtures', 'workflow.json')

    const result = importWorkflowFromSelectedPath(filePath, repository, {
      getFileSize: () => makeWorkflow().length,
      readTextFile: () => makeWorkflow(),
      runInTransaction: (operation) => {
        transactionStarted()
        return operation()
      }
    })

    expect(result).toMatchObject({
      id: 'workflow-id',
      name: 'workflow',
      category: 'generation'
    })
    expect(transactionStarted).toHaveBeenCalledOnce()
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow',
        description: 'Imported from workflow.json',
        api_json: makeWorkflow()
      })
    )
    expect(repository.setVariables).toHaveBeenCalledWith('workflow-id', expect.any(Array))
  })

  it('uses the real selected file for size and content reads', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-import-'))
    const filePath = join(directory, 'selected.json')
    writeFileSync(filePath, makeWorkflow(), 'utf-8')

    try {
      const repository = makeRepository()
      const result = importWorkflowFromSelectedPath(filePath, repository, {
        runInTransaction: (operation) => operation()
      })

      expect(result.name).toBe('selected')
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ api_json: makeWorkflow() })
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects paths that were not selected as absolute JSON files', () => {
    const repository = makeRepository()
    expect(() => importWorkflowFromSelectedPath('workflow.json', repository)).toThrow(
      'absolute JSON'
    )
    expect(() =>
      importWorkflowFromSelectedPath(resolve('fixtures', 'workflow.txt'), repository)
    ).toThrow('absolute JSON')
  })

  it('rejects oversized workflow files before reading them', () => {
    const repository = makeRepository()
    const readTextFile = vi.fn(() => makeWorkflow())

    expect(() =>
      importWorkflowFromSelectedPath(resolve('fixtures', 'workflow.json'), repository, {
        getFileSize: () => MAX_WORKFLOW_FILE_SIZE_BYTES + 1,
        readTextFile
      })
    ).toThrow('10MB')
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('rejects malformed and UI-format workflow files without persisting', () => {
    const repository = makeRepository()
    const filePath = resolve('fixtures', 'workflow.json')

    expect(() =>
      importWorkflowFromSelectedPath(filePath, repository, {
        getFileSize: () => 1,
        readTextFile: () => '{'
      })
    ).toThrow('Workflow file')

    expect(() =>
      importWorkflowFromSelectedPath(filePath, repository, {
        getFileSize: () => 1,
        readTextFile: () => JSON.stringify({ nodes: [], links: [] })
      })
    ).toThrow('UI format')

    expect(repository.create).not.toHaveBeenCalled()
  })
})
