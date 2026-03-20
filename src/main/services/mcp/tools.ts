import {
  ModuleRepository,
  ModuleItemRepository,
  WorkflowRepository,
  BatchJobRepository,
  BatchTaskRepository
} from '../database/repositories'
import { expandBatchToTasks } from '../batch/task-generator'
import type { BatchConfig } from '../batch/task-generator'
import { queueManager } from '../batch/queue-manager'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const moduleRepo = new ModuleRepository()
const moduleItemRepo = new ModuleItemRepository()
const workflowRepo = new WorkflowRepository()
const batchJobRepo = new BatchJobRepository()
const batchTaskRepo = new BatchTaskRepository()

export function registerMcpTools(server: McpServer): void {
  // === Module Management ===

  server.tool(
    'list_modules',
    'List all prompt modules. Optionally filter by type (character, outfit, emotion, style, artist, quality, negative, lora, custom).',
    { type: z.string().optional().describe('Module type filter') },
    async ({ type }) => {
      const modules = moduleRepo.list(type)
      return {
        content: [{ type: 'text', text: JSON.stringify(modules, null, 2) }]
      }
    }
  )

  server.tool(
    'get_module',
    'Get a specific prompt module by ID, including its items.',
    { id: z.string().describe('Module ID') },
    async ({ id }) => {
      const mod = moduleRepo.get(id)
      if (!mod) {
        return {
          content: [{ type: 'text', text: `Module not found: ${id}` }],
          isError: true
        }
      }
      const items = moduleItemRepo.list(id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ module: mod, items }, null, 2) }]
      }
    }
  )

  server.tool(
    'create_module',
    'Create a new prompt module.',
    {
      name: z.string().describe('Module name'),
      type: z.enum(['character', 'outfit', 'emotion', 'style', 'artist', 'quality', 'negative', 'lora', 'custom']).describe('Module type'),
      description: z.string().optional().describe('Module description')
    },
    async ({ name, type, description }) => {
      const id = moduleRepo.create({ name, type, description })
      return {
        content: [{ type: 'text', text: JSON.stringify({ id, name, type }, null, 2) }]
      }
    }
  )

  server.tool(
    'update_module',
    'Update an existing prompt module.',
    {
      id: z.string().describe('Module ID'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description')
    },
    async ({ id, name, description }) => {
      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
      moduleRepo.update(id, data)
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }]
      }
    }
  )

  server.tool(
    'delete_module',
    'Delete a prompt module and all its items.',
    { id: z.string().describe('Module ID') },
    async ({ id }) => {
      moduleRepo.delete(id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }]
      }
    }
  )

  // === Module Item Management ===

  server.tool(
    'list_module_items',
    'List all items in a prompt module.',
    { module_id: z.string().describe('Module ID') },
    async ({ module_id }) => {
      const items = moduleItemRepo.list(module_id)
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      }
    }
  )

  server.tool(
    'create_module_item',
    'Create a new item in a prompt module.',
    {
      module_id: z.string().describe('Module ID'),
      name: z.string().describe('Item name'),
      prompt: z.string().describe('Positive prompt text'),
      negative: z.string().optional().describe('Negative prompt text'),
      weight: z.number().optional().describe('Weight (default: 1.0)')
    },
    async ({ module_id, name, prompt, negative, weight }) => {
      const id = moduleItemRepo.create({
        module_id,
        name,
        prompt,
        negative: negative || '',
        weight: weight ?? 1.0
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ id, name, module_id }) }]
      }
    }
  )

  server.tool(
    'update_module_item',
    'Update an existing module item.',
    {
      id: z.string().describe('Item ID'),
      name: z.string().optional().describe('New name'),
      prompt: z.string().optional().describe('New prompt text'),
      negative: z.string().optional().describe('New negative prompt'),
      weight: z.number().optional().describe('New weight')
    },
    async ({ id, name, prompt, negative, weight }) => {
      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (prompt !== undefined) data.prompt = prompt
      if (negative !== undefined) data.negative = negative
      if (weight !== undefined) data.weight = weight
      moduleItemRepo.update(id, data)
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }]
      }
    }
  )

  server.tool(
    'delete_module_item',
    'Delete a module item.',
    { id: z.string().describe('Item ID') },
    async ({ id }) => {
      moduleItemRepo.delete(id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }]
      }
    }
  )

  // === Workflow Management ===

  server.tool(
    'list_workflows',
    'List all workflows. Optionally filter by category (generation, upscale, detailer, custom).',
    { category: z.string().optional().describe('Category filter') },
    async ({ category }) => {
      const workflows = workflowRepo.list(category)
      return {
        content: [{ type: 'text', text: JSON.stringify(workflows, null, 2) }]
      }
    }
  )

  server.tool(
    'get_workflow',
    'Get a specific workflow by ID, including its variables.',
    { id: z.string().describe('Workflow ID') },
    async ({ id }) => {
      const workflow = workflowRepo.get(id)
      if (!workflow) {
        return {
          content: [{ type: 'text', text: `Workflow not found: ${id}` }],
          isError: true
        }
      }
      const variables = workflowRepo.getVariables(id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ workflow, variables }, null, 2) }]
      }
    }
  )

  // === Batch Job Management ===

  server.tool(
    'create_batch_job',
    'Create a batch job that generates images from module combinations. Requires a workflow ID and module selections.',
    {
      name: z.string().describe('Job name'),
      description: z.string().optional().describe('Job description'),
      workflow_id: z.string().describe('Workflow ID to use'),
      module_selections: z.array(z.object({
        moduleId: z.string().describe('Module ID'),
        moduleType: z.string().describe('Module type'),
        selectedItemIds: z.array(z.string()).optional().describe('Selected item IDs (all if omitted)')
      })).describe('Module selections for batch combinations'),
      count_per_combination: z.number().default(1).describe('Images per combination'),
      seed_mode: z.enum(['random', 'fixed', 'incremental']).default('random').describe('Seed mode'),
      fixed_seed: z.number().optional().describe('Fixed seed value (for fixed/incremental mode)')
    },
    async ({ name, description, workflow_id, module_selections, count_per_combination, seed_mode, fixed_seed }) => {
      // Validate workflow exists
      const workflow = workflowRepo.get(workflow_id)
      if (!workflow) {
        return {
          content: [{ type: 'text', text: `Workflow not found: ${workflow_id}` }],
          isError: true
        }
      }

      // Build config
      const config: BatchConfig = {
        name,
        description,
        workflowId: workflow_id,
        moduleSelections: module_selections.map(sel => ({
          moduleId: sel.moduleId,
          moduleType: sel.moduleType,
          selectedItemIds: sel.selectedItemIds || moduleItemRepo.list(sel.moduleId).map(i => i.id as string)
        })),
        countPerCombination: count_per_combination,
        seedMode: seed_mode,
        fixedSeed: fixed_seed,
        outputFolderPattern: '{job}/{character}/{outfit}/{emotion}',
        fileNamePattern: '{character}_{outfit}_{emotion}_{index}'
      }

      // Load module data for expansion
      const moduleData = config.moduleSelections.map((sel) => {
        const items = moduleItemRepo.list(sel.moduleId)
        return {
          moduleId: sel.moduleId,
          moduleType: sel.moduleType,
          items: items.map((item) => ({
            id: item.id as string,
            name: item.name as string,
            prompt: item.prompt as string,
            negative: (item.negative as string) || '',
            weight: (item.weight as number) || 1.0,
            enabled: (item.enabled as number) !== 0
          }))
        }
      })

      // Expand tasks
      const tasks = expandBatchToTasks(config, moduleData)

      // Create the job
      const jobId = batchJobRepo.create({
        name: config.name,
        description: config.description,
        config: JSON.stringify(config),
        workflow_id: config.workflowId,
        total_tasks: tasks.length
      })

      // Create tasks in bulk
      if (tasks.length > 0) {
        batchTaskRepo.createBulk(
          tasks.map((t) => ({
            job_id: jobId,
            prompt_data: JSON.stringify(t.promptData),
            sort_order: t.sortOrder,
            metadata: JSON.stringify(t.metadata)
          }))
        )
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ jobId, totalTasks: tasks.length, name }) }]
      }
    }
  )

  server.tool(
    'start_batch_job',
    'Start executing a batch job. The job must be in draft status and ComfyUI must be connected.',
    { job_id: z.string().describe('Batch job ID') },
    async ({ job_id }) => {
      try {
        await queueManager.startJob(job_id)
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, job_id }) }]
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to start job: ${(error as Error).message}` }],
          isError: true
        }
      }
    }
  )

  server.tool(
    'list_batch_jobs',
    'List batch jobs. Optionally filter by status (draft, queued, running, paused, completed, failed, cancelled).',
    { status: z.string().optional().describe('Status filter') },
    async ({ status }) => {
      const jobs = batchJobRepo.list(status)
      return {
        content: [{ type: 'text', text: JSON.stringify(jobs, null, 2) }]
      }
    }
  )

  server.tool(
    'get_batch_job',
    'Get detailed information about a specific batch job.',
    { id: z.string().describe('Batch job ID') },
    async ({ id }) => {
      const job = batchJobRepo.get(id)
      if (!job) {
        return {
          content: [{ type: 'text', text: `Batch job not found: ${id}` }],
          isError: true
        }
      }
      const tasks = batchTaskRepo.listByJob(id)
      return {
        content: [{ type: 'text', text: JSON.stringify({ job, taskCount: tasks.length, tasks: tasks.slice(0, 10) }, null, 2) }]
      }
    }
  )
}
