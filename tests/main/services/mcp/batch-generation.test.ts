import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BatchConfig } from '@shared/ipc-contract'
import type { ModuleDataSnapshot } from '../../../../src/main/services/batch/task-generator'
import { z } from 'zod'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'

const state = vi.hoisted(() => ({
  path: '',
  queue: { isProcessing: false, isPaused: false, currentJobId: null, requestStart: vi.fn() }
}))
vi.mock('electron', () => ({ app: { getPath: () => state.path } }))
vi.mock('@main/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../../../src/main/services/batch/queue-manager', () => ({ queueManager: state.queue }))

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>
const tools = new Map<string, { schema: z.ZodObject<z.ZodRawShape>; handler: Handler }>()
let database: typeof import('../../../../src/main/services/database')
let repos: typeof import('../../../../src/main/services/mcp/tools/shared')
let generator: typeof import('../../../../src/main/services/batch/task-generator')
let injection: typeof import('../../../../src/main/services/batch/prompt-injection')
let input: Record<string, unknown>
let characterItem: string
let cfgId: string
let workflowId: string

const workflow = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: 'original positive' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: 'original negative' } },
  '3': {
    class_type: 'KSampler',
    inputs: { positive: ['1', 0], negative: ['2', 0], cfg: 7, seed: 0, steps: 20 }
  }
}

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = tools.get(name)!
  return tool.handler(tool.schema.parse(args))
}

async function create(): Promise<string> {
  const result = await call('create_batch_job', input)
  expect(result.isError).not.toBe(true)
  return result.structuredContent!.jobId as string
}

beforeEach(async () => {
  vi.resetModules()
  state.queue.requestStart.mockReset().mockReturnValue({ success: true })
  state.path = mkdtempSync(join(tmpdir(), 'comfyui-mcp-generation-test-'))
  database = await import('../../../../src/main/services/database')
  await database.initDatabase()
  repos = await import('../../../../src/main/services/mcp/tools/shared')
  generator = await import('../../../../src/main/services/batch/task-generator')
  injection = await import('../../../../src/main/services/batch/prompt-injection')
  workflowId = repos.workflowRepo.create({
    name: 'Portrait',
    category: 'generation',
    api_json: JSON.stringify(workflow)
  })
  repos.workflowRepo.setVariables(workflowId, [
    {
      node_id: '1',
      field_name: 'text',
      display_name: 'Positive',
      var_type: 'text',
      role: 'prompt_positive'
    },
    {
      node_id: '2',
      field_name: 'text',
      display_name: 'Negative',
      var_type: 'text',
      role: 'prompt_negative'
    },
    { node_id: '3', field_name: 'cfg', display_name: 'CFG', var_type: 'number', role: 'custom' }
  ])
  cfgId = String(
    repos.workflowRepo.getVariables(workflowId).find((v) => v.field_name === 'cfg')!.id
  )
  const character = repos.moduleRepo.create({ name: 'Character', type: 'character' })
  const emotions = repos.moduleRepo.create({ name: 'Emotions', type: 'emotion' })
  const negative = repos.moduleRepo.create({ name: 'Negative', type: 'negative' })
  repos.moduleItemRepo.create({ module_id: negative, name: 'Avoid', prompt: 'blurry, lowres' })
  characterItem = repos.moduleItemRepo.create({
    module_id: character,
    name: 'Alice',
    prompt: 'alice, blue_eyes',
    negative: 'blurry'
  })
  for (const [index, emotion] of ['happy', 'angry', 'sad'].entries()) {
    repos.moduleItemRepo.create({
      module_id: emotions,
      name: emotion,
      prompt: emotion,
      negative: 'lowres',
      sort_order: index
    })
  }
  input = {
    name: 'Alice emotions',
    workflow_id: workflowId,
    module_selections: [{ moduleId: character }, { moduleId: emotions }, { moduleId: negative }],
    count_per_combination: 2,
    seed_mode: 'incremental',
    fixed_seed: 42
  }
  const { registerWorkflowAndBatchTools } =
    await import('../../../../src/main/services/mcp/tools/workflows-batch')
  tools.clear()
  registerWorkflowAndBatchTools({
    tool: (name: string, _description: string, schema: z.ZodRawShape, handler: Handler) =>
      tools.set(name, { schema: z.object(schema), handler })
  } as unknown as McpServer)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.closeDatabase()
  const target = resolve(state.path)
  const child = relative(resolve(tmpdir()), target)
  if (
    !child ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child) ||
    !basename(target).startsWith('comfyui-mcp-generation-test-')
  )
    throw new Error(`Unexpected test directory: ${target}`)
  rmSync(target, { recursive: true, force: true })
})

describe('MCP batch generation integration', () => {
  it('rejects empty, NaN and infinite numeric overrides before creating a draft', async () => {
    for (const value of ['', ' ', 'NaN', 'Infinity', '-Infinity']) {
      await expect(
        call('create_batch_job', { ...input, variable_overrides: [{ variableId: cfgId, value }] })
      ).rejects.toThrow(/finite number/i)
    }
    expect(repos.batchJobRepo.list()).toHaveLength(0)
  })

  it('rejects duplicate variable override IDs instead of silently using the last value', async () => {
    await expect(
      call('create_batch_job', {
        ...input,
        variable_overrides: [
          { variableId: cfgId, value: '4' },
          { variableId: cfgId, value: '8' }
        ]
      })
    ).rejects.toThrow(/duplicate/i)
    expect(repos.batchJobRepo.list()).toHaveLength(0)
  })

  it('requires explicit mappings to cover every detected prompt slot', async () => {
    const positive = repos.workflowRepo
      .getVariables(workflowId)
      .find((v) => v.role === 'prompt_positive')!
    await expect(
      call('preview_batch_job', { ...input, slot_mappings: [{ variableId: positive.id }] })
    ).rejects.toThrow()
    expect(repos.batchJobRepo.list()).toHaveLength(0)
  })

  it('validates variants for every enabled prefix item, including unselected ones', async () => {
    const selections = input.module_selections as Array<{ moduleId: string }>
    const characterModuleId = selections[0].moduleId
    repos.moduleItemRepo.update(characterItem, {
      prompt_variants: JSON.stringify({ natural: { prompt: 'Alice portrait', negative: '' } })
    })
    repos.moduleItemRepo.create({
      module_id: characterModuleId,
      name: 'Prefix item without variant',
      prompt: 'extra'
    })
    const variables = repos.workflowRepo.getVariables(workflowId)
    await expect(
      call('preview_batch_job', {
        ...input,
        module_selections: selections.map((selection, index) =>
          index === 0 ? { ...selection, selectedItemIds: [characterItem] } : selection
        ),
        slot_mappings: [
          {
            variableId: variables.find((v) => v.role === 'prompt_positive')!.id,
            assignedModuleIds: [characterModuleId],
            prefixModuleIds: [characterModuleId],
            promptVariant: 'natural'
          },
          {
            variableId: variables.find((v) => v.role === 'prompt_negative')!.id,
            action: 'fixed',
            fixedValue: ''
          }
        ]
      })
    ).rejects.toThrow(/variant/i)
  })

  it('checks the saved execution token before starting after a workflow change', async () => {
    const created = await call('create_batch_job', input)
    const id = created.structuredContent!.jobId
    const token = created.structuredContent!.execution_token
    expect(token).toEqual(expect.any(String))
    const started = await call('start_batch_job', { job_id: id, execution_token: token })
    expect(started.isError).not.toBe(true)
    expect(state.queue.requestStart).toHaveBeenCalledWith(id)
    state.queue.requestStart.mockClear()
    repos.workflowRepo.update(workflowId, {
      api_json: JSON.stringify({
        ...workflow,
        '4': { class_type: 'SaveImage', inputs: { filename_prefix: 'changed' } }
      })
    })
    const stale = await call('start_batch_job', { job_id: id, execution_token: token })
    expect(stale.isError).toBe(true)
    expect(state.queue.requestStart).not.toHaveBeenCalled()
    expect(repos.batchJobRepo.get(String(id))!.status).toBe('draft')
  })

  it('retains a draft ID and removes only unexecuted pending tasks when applying new settings', async () => {
    const id = await create()
    repos.batchTaskRepo.createSingle({
      job_id: id,
      prompt_data: '{}',
      sort_order: 0,
      metadata: '{}'
    })
    const result = await call('update_batch_job', {
      ...input,
      job_id: id,
      name: 'Reconfigured pending draft'
    })
    expect(result.structuredContent).toMatchObject({ jobId: id, cloned: false })
    expect(repos.batchTaskRepo.listByJob(id)).toHaveLength(0)
    expect(repos.batchJobRepo.list()).toHaveLength(1)
  })

  it('previews one character × three emotions × two images with exact injected slots and explicit overrides', async () => {
    const injectSpy = vi.spyOn(injection, 'injectPromptData')
    const result = await call('preview_batch_job', {
      ...input,
      sample_limit: 6,
      variable_overrides: [{ variableId: cfgId, value: '4.5' }]
    })
    expect(result.structuredContent).toMatchObject({
      total_tasks: 6,
      total_combinations: 3,
      has_more: false
    })
    const samples = result.structuredContent!.samples as Array<{
      seed: number
      slots: Array<{ role: string; text: string }>
    }>
    expect(samples.map((s) => s.seed)).toEqual([42, 43, 44, 45, 46, 47])
    expect(
      samples.map((s) => s.slots.find((slot) => slot.role === 'prompt_positive')!.text)
    ).toEqual(
      ['happy', 'happy', 'angry', 'angry', 'sad', 'sad'].map(
        (emotion) => `alice, blue_eyes, ${emotion}`
      )
    )
    expect(
      samples.map((s) => s.slots.find((slot) => slot.role === 'prompt_negative')!.text)
    ).toEqual(Array(6).fill('blurry, lowres'))
    expect(injectSpy).toHaveBeenCalledTimes(6)
    const rendered = injectSpy.mock.calls[0][0] as typeof workflow
    expect(rendered['3'].inputs.cfg).toBe(4.5)
    expect(repos.batchJobRepo.list()).toHaveLength(0)
  })

  it('rejects a stale preview after module or workflow changes without creating a draft', async () => {
    const preview = await call('preview_batch_job', input)
    repos.moduleItemRepo.update(characterItem, { prompt: 'changed character' })
    const result = await call('create_batch_job', {
      ...input,
      preview_token: preview.structuredContent!.preview_token
    })
    expect(result.isError).toBe(true)
    expect(repos.batchJobRepo.list()).toHaveLength(0)
    const fresh = await call('preview_batch_job', input)
    repos.workflowRepo.update(workflowId, {
      api_json: JSON.stringify({
        ...workflow,
        '4': { class_type: 'SaveImage', inputs: { filename_prefix: 'changed' } }
      })
    })
    expect(
      (
        await call('create_batch_job', {
          ...input,
          preview_token: fresh.structuredContent!.preview_token
        })
      ).isError
    ).toBe(true)
  })

  it('creates a draft snapshot that keeps original prompts after source changes', async () => {
    const id = await create()
    repos.moduleItemRepo.update(characterItem, { prompt: 'changed character' })
    const job = repos.batchJobRepo.get(id)!
    const config = JSON.parse(String(job.config)) as BatchConfig
    const snapshot = JSON.parse(String(job.module_data_snapshot)) as ModuleDataSnapshot
    const tasks = generator.expandBatchToTasksChunk(config, snapshot, 0, 6)
    const rendered = structuredClone(workflow)
    injection.injectPromptData(rendered, tasks[0].promptData)
    expect(job.status).toBe('draft')
    expect(tasks).toHaveLength(6)
    expect(rendered['1'].inputs.text).toBe('alice, blue_eyes, happy')
    expect(repos.batchTaskRepo.listByJob(id)).toHaveLength(0)
  })

  it.each([null, { unexpected: true }])(
    'rejects non-primitive overrides before saving: %j',
    async (value) => {
      const changed = structuredClone(workflow) as Record<
        string,
        { inputs: Record<string, unknown> }
      >
      changed['3'].inputs.cfg = value
      repos.workflowRepo.update(workflowId, { api_json: JSON.stringify(changed) })
      await expect(
        call('create_batch_job', {
          ...input,
          variable_overrides: [{ variableId: cfgId, value: '4' }]
        })
      ).rejects.toThrow('not a primitive')
      expect(repos.batchJobRepo.list()).toHaveLength(0)
    }
  )

  it('rejects a numeric input incorrectly marked as a prompt slot', async () => {
    const variables = repos.workflowRepo.getVariables(workflowId)
    repos.workflowRepo.setVariables(
      workflowId,
      variables.map((variable) => ({
        node_id: String(variable.node_id),
        field_name: String(variable.field_name),
        display_name: String(variable.display_name),
        var_type: String(variable.var_type),
        role: variable.id === cfgId ? 'prompt_positive' : String(variable.role)
      }))
    )
    await expect(call('create_batch_job', input)).rejects.toThrow('requires a text input')
    expect(repos.batchJobRepo.list()).toHaveLength(0)
  })

  it('updates an untouched draft in place and clones completed jobs preserving history', async () => {
    const id = await create()
    const update = await call('update_batch_job', { ...input, job_id: id, name: 'Revised' })
    expect(update.structuredContent).toMatchObject({ jobId: id, cloned: false })
    repos.batchJobRepo.updateStatus(id, 'completed')
    const before = repos.batchJobRepo.get(id)
    const clone = await call('update_batch_job', { ...input, job_id: id, name: 'Second pass' })
    expect(clone.structuredContent).toMatchObject({ cloned: true, source_job_id: id })
    expect(clone.structuredContent!.jobId).not.toBe(id)
    expect(repos.batchJobRepo.get(id)).toEqual(before)
    expect(repos.batchJobRepo.list()).toHaveLength(2)
  })

  it('pages task metadata and statuses while blocking replacement of uncertain work', async () => {
    const id = await create()
    const taskIds = ['happy', 'angry', 'sad'].map((emotion, index) =>
      repos.batchTaskRepo.createSingle({
        job_id: id,
        prompt_data: '{}',
        sort_order: index,
        metadata: JSON.stringify({ emotionName: emotion })
      })
    )
    repos.batchTaskRepo.updateStatus(taskIds[0], 'completed')
    repos.batchTaskRepo.updateStatus(taskIds[1], 'uncertain', {
      comfyui_prompt_id: 'keep-prompt-id',
      error_message: 'Response lost'
    })
    const page = await call('list_batch_tasks', { job_id: id, limit: 1, offset: 1 })
    expect(page.structuredContent).toMatchObject({
      total: 3,
      has_more: true,
      unmaterialized_tasks: 3,
      tasks: [
        {
          status: 'uncertain',
          comfyui_prompt_id: 'keep-prompt-id',
          metadata: { emotionName: 'angry' }
        }
      ]
    })
    const filtered = await call('list_batch_tasks', { job_id: id, status: 'uncertain', limit: 1 })
    expect(filtered.structuredContent).toMatchObject({ total: 1, has_more: false })
    expect((await call('update_batch_job', { ...input, job_id: id })).isError).toBe(true)
    expect(repos.batchJobRepo.list()).toHaveLength(1)
    expect(repos.batchTaskRepo.get(taskIds[1])).toMatchObject({
      comfyui_prompt_id: 'keep-prompt-id',
      status: 'uncertain'
    })
    await expect(call('list_batch_tasks', { job_id: id, limit: 101 })).rejects.toThrow()
  })
})
