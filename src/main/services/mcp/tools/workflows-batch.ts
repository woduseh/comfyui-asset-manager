import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleItemRepo, workflowRepo, batchJobRepo, batchTaskRepo } from './shared'
import { expandBatchToTasks } from '../../batch/task-generator'
import type { BatchConfig } from '../../batch/task-generator'
import { queueManager } from '../../batch/queue-manager'
import { validatePromptVariants } from '../../../ipc/validators'

export function registerWorkflowAndBatchTools(server: McpServer): void {
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
    'Create a batch job that generates images from module combinations. Requires a workflow ID and module selections. Supports slot mappings with prompt variants for per-slot different prompts.',
    {
      name: z.string().describe('Job name'),
      description: z.string().optional().describe('Job description'),
      workflow_id: z.string().describe('Workflow ID to use'),
      module_selections: z
        .array(
          z.object({
            moduleId: z.string().describe('Module ID'),
            moduleType: z.string().describe('Module type'),
            selectedItemIds: z
              .array(z.string())
              .optional()
              .describe('Selected item IDs (all if omitted)')
          })
        )
        .describe('Module selections for batch combinations'),
      count_per_combination: z.number().default(1).describe('Images per combination'),
      seed_mode: z.enum(['random', 'fixed', 'incremental']).default('random').describe('Seed mode'),
      fixed_seed: z.number().optional().describe('Fixed seed value (for fixed/incremental mode)'),
      slot_mappings: z
        .array(
          z.object({
            variableId: z.string().describe('Workflow variable ID'),
            nodeId: z.string().describe('ComfyUI node ID'),
            fieldName: z.string().describe('Node field name'),
            role: z.string().describe('Slot role: prompt_positive or prompt_negative'),
            action: z
              .enum(['inject', 'fixed'])
              .default('inject')
              .describe('Action: inject modules or use fixed value'),
            fixedValue: z.string().optional().describe('Fixed prompt text (when action=fixed)'),
            assignedModuleIds: z
              .array(z.string())
              .optional()
              .describe('Module IDs to inject into this slot'),
            prefixModuleIds: z.array(z.string()).optional().describe('Module IDs for prefix'),
            prefixText: z.string().optional().describe('Additional prefix text'),
            suffixText: z.string().optional().describe('Additional suffix text'),
            promptVariant: z
              .string()
              .optional()
              .describe(
                'Prompt variant name to use for this slot (e.g. "natural_language" or "tags")'
              )
          })
        )
        .optional()
        .describe('Slot mappings for multi-model workflows with per-slot prompt variant selection')
    },
    async ({
      name,
      description,
      workflow_id,
      module_selections,
      count_per_combination,
      seed_mode,
      fixed_seed,
      slot_mappings
    }) => {
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
        moduleSelections: module_selections.map((sel) => ({
          moduleId: sel.moduleId,
          moduleType: sel.moduleType,
          selectedItemIds:
            sel.selectedItemIds || moduleItemRepo.list(sel.moduleId).map((i) => i.id as string)
        })),
        countPerCombination: count_per_combination,
        seedMode: seed_mode,
        fixedSeed: fixed_seed,
        outputFolderPattern: '{job}/{character}/{outfit}/{emotion}',
        fileNamePattern: '{character}_{outfit}_{emotion}_{index}',
        slotMappings: slot_mappings?.map((sm) => ({
          variableId: sm.variableId,
          nodeId: sm.nodeId,
          fieldName: sm.fieldName,
          role: sm.role,
          action: sm.action,
          fixedValue: sm.fixedValue || '',
          assignedModuleIds: sm.assignedModuleIds || [],
          prefixModuleIds: sm.prefixModuleIds || [],
          prefixText: sm.prefixText || '',
          suffixText: sm.suffixText || '',
          promptVariant: sm.promptVariant
        }))
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
            enabled: (item.enabled as number) !== 0,
            prompt_variants: validatePromptVariants(item.prompt_variants as string)
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
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { job, taskCount: tasks.length, tasks: tasks.slice(0, 10) },
              null,
              2
            )
          }
        ]
      }
    }
  )
}
