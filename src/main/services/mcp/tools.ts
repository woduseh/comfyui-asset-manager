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
import { tagService } from '../tags'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

function parsePromptVariants(raw: unknown): Record<string, { prompt: string; negative: string }> {
  if (!raw || typeof raw !== 'string' || raw === '{}') return {}
  try { return JSON.parse(raw) } catch { return {} }
}

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
    'Create a new item in a prompt module. Supports optional prompt variants for per-slot different prompts.',
    {
      module_id: z.string().describe('Module ID'),
      name: z.string().describe('Item name'),
      prompt: z.string().describe('Positive prompt text (default)'),
      negative: z.string().optional().describe('Negative prompt text (default)'),
      weight: z.number().optional().describe('Weight (default: 1.0)'),
      prompt_variants: z.record(z.string(), z.object({
        prompt: z.string().describe('Variant positive prompt'),
        negative: z.string().describe('Variant negative prompt')
      })).optional().describe('Named prompt variants, e.g. {"natural_language": {prompt: "...", negative: "..."}, "tags": {prompt: "...", negative: "..."}}')
    },
    async ({ module_id, name, prompt, negative, weight, prompt_variants }) => {
      const id = moduleItemRepo.create({
        module_id,
        name,
        prompt,
        negative: negative || '',
        weight: weight ?? 1.0,
        prompt_variants: prompt_variants ? JSON.stringify(prompt_variants) : '{}'
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ id, name, module_id }) }]
      }
    }
  )

  server.tool(
    'update_module_item',
    'Update an existing module item. Supports prompt variants for per-slot different prompts.',
    {
      id: z.string().describe('Item ID'),
      name: z.string().optional().describe('New name'),
      prompt: z.string().optional().describe('New default prompt text'),
      negative: z.string().optional().describe('New default negative prompt'),
      weight: z.number().optional().describe('New weight'),
      prompt_variants: z.record(z.string(), z.object({
        prompt: z.string().describe('Variant positive prompt'),
        negative: z.string().describe('Variant negative prompt')
      })).optional().describe('Named prompt variants (replaces all existing variants)')
    },
    async ({ id, name, prompt, negative, weight, prompt_variants }) => {
      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (prompt !== undefined) data.prompt = prompt
      if (negative !== undefined) data.negative = negative
      if (weight !== undefined) data.weight = weight
      if (prompt_variants !== undefined) data.prompt_variants = JSON.stringify(prompt_variants)
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
    'Create a batch job that generates images from module combinations. Requires a workflow ID and module selections. Supports slot mappings with prompt variants for per-slot different prompts.',
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
      fixed_seed: z.number().optional().describe('Fixed seed value (for fixed/incremental mode)'),
      slot_mappings: z.array(z.object({
        variableId: z.string().describe('Workflow variable ID'),
        nodeId: z.string().describe('ComfyUI node ID'),
        fieldName: z.string().describe('Node field name'),
        role: z.string().describe('Slot role: prompt_positive or prompt_negative'),
        action: z.enum(['inject', 'fixed']).default('inject').describe('Action: inject modules or use fixed value'),
        fixedValue: z.string().optional().describe('Fixed prompt text (when action=fixed)'),
        assignedModuleIds: z.array(z.string()).optional().describe('Module IDs to inject into this slot'),
        prefixModuleIds: z.array(z.string()).optional().describe('Module IDs for prefix'),
        prefixText: z.string().optional().describe('Additional prefix text'),
        suffixText: z.string().optional().describe('Additional suffix text'),
        promptVariant: z.string().optional().describe('Prompt variant name to use for this slot (e.g. "natural_language" or "tags")')
      })).optional().describe('Slot mappings for multi-model workflows with per-slot prompt variant selection')
    },
    async ({ name, description, workflow_id, module_selections, count_per_combination, seed_mode, fixed_seed, slot_mappings }) => {
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
        fileNamePattern: '{character}_{outfit}_{emotion}_{index}',
        slotMappings: slot_mappings?.map(sm => ({
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
            prompt_variants: parsePromptVariants(item.prompt_variants as string)
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

  // === Danbooru Tag Tools ===

  server.tool(
    'validate_danbooru_tags',
    'Validate whether given tags are valid Danbooru tags. Returns validation result for each tag with suggestions for invalid ones. IMPORTANT: Always use this tool to verify your tags before creating module items with prompts.',
    {
      tags: z.array(z.string()).describe('List of tags to validate (e.g. ["blue_eyes", "long_hair", "school_uniform"])'),
      online_fallback: z.boolean().optional().default(true).describe('If true, check Danbooru API for tags not found locally (default: true)')
    },
    async ({ tags, online_fallback }) => {
      if (!tagService.isLoaded()) {
        return {
          content: [{ type: 'text', text: 'Tag database not loaded. Please try again later.' }],
          isError: true
        }
      }

      const results = await tagService.validate(tags, online_fallback)
      const validCount = results.filter((r) => r.valid).length
      const invalidCount = results.filter((r) => !r.valid).length

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary: `${validCount}/${tags.length} tags valid${invalidCount > 0 ? `, ${invalidCount} invalid` : ''}`,
            results
          }, null, 2)
        }]
      }
    }
  )

  server.tool(
    'search_danbooru_tags',
    'Search for Danbooru tags matching a query. Use this to find the correct tag name for a concept. Supports wildcard (*) patterns. Results are sorted by popularity (post count).',
    {
      query: z.string().describe('Search query (e.g. "blue_eye", "long_h*", "school"). Supports * wildcard.'),
      category: z.enum(['general', 'artist', 'copyright', 'character', 'meta']).optional()
        .describe('Filter by tag category'),
      limit: z.number().optional().default(20).describe('Max results (default: 20, max: 50)')
    },
    async ({ query, category, limit }) => {
      if (!tagService.isLoaded()) {
        return {
          content: [{ type: 'text', text: 'Tag database not loaded. Please try again later.' }],
          isError: true
        }
      }

      const clampedLimit = Math.min(limit ?? 20, 50)
      const results = await tagService.searchWithOnline(query, category, clampedLimit)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            count: results.length,
            tags: tagService.formatTagsForDisplay(results)
          }, null, 2)
        }]
      }
    }
  )

  server.tool(
    'get_popular_danbooru_tags',
    'Get popular Danbooru tags sorted by usage count. Use group_by_semantic=true to get tags organized by category (hair, eyes, clothing, pose, etc.) — very useful when writing character prompts.',
    {
      category: z.enum(['general', 'artist', 'copyright', 'character', 'meta']).optional()
        .describe('Filter by tag category (most character-related tags are "general")'),
      limit: z.number().optional().default(100).describe('Max results per group or total (default: 100, max: 500)'),
      group_by_semantic: z.boolean().optional().default(false)
        .describe('If true, returns tags grouped by semantic category (hair_color, eye_color, clothing, pose, etc.)')
    },
    async ({ category, limit, group_by_semantic }) => {
      if (!tagService.isLoaded()) {
        return {
          content: [{ type: 'text', text: 'Tag database not loaded. Please try again later.' }],
          isError: true
        }
      }

      if (group_by_semantic) {
        const groups = tagService.getPopularGrouped()
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              description: 'Popular Danbooru tags grouped by semantic category. Use these as reference when writing prompts.',
              groups
            }, null, 2)
          }]
        }
      }

      const clampedLimit = Math.min(limit ?? 100, 500)
      const results = tagService.getPopular(category, clampedLimit)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: results.length,
            tags: tagService.formatTagsForDisplay(results)
          }, null, 2)
        }]
      }
    }
  )

  // === Danbooru Tag Prompt Template ===

  server.prompt(
    'danbooru_tag_guide',
    'Guidelines and reference for writing image generation prompts using Danbooru tags. Call this before creating character prompts to get the correct tag format and popular tags.',
    { character_description: z.string().optional().describe('Optional character description for context-aware guidance') },
    ({ character_description }) => {
      const groups = tagService.isLoaded() ? tagService.getPopularGrouped() : {}

      let guideText = `# Danbooru Tag Prompt Guide

## Tag Format Rules
- Use **underscores** instead of spaces: \`long_hair\` not \`long hair\`
- All lowercase: \`blue_eyes\` not \`Blue_Eyes\`
- Use established compound tags: \`hair_ornament\`, \`looking_at_viewer\`
- Separate tags with commas: \`1girl, solo, long_hair, blue_eyes\`
- Do NOT invent new tags — always verify with \`validate_danbooru_tags\` tool

## Tag Categories (Danbooru)
- **General (0)**: Descriptive tags for appearance, actions, objects (most commonly used)
- **Artist (1)**: Artist name tags
- **Copyright (3)**: Series/franchise tags
- **Character (4)**: Specific character name tags
- **Meta (5)**: Technical tags (e.g., highres, absurdres)

## Prompt Writing Tips
1. Start with composition: \`1girl, solo\` or \`2girls, multiple_girls\`
2. Add hair: color + style (e.g., \`blonde_hair, long_hair, ponytail\`)
3. Add eyes: \`blue_eyes\`, \`red_eyes\`, etc.
4. Add expression: \`smile\`, \`blush\`, \`open_mouth\`
5. Add clothing: \`school_uniform\`, \`dress\`, \`armor\`
6. Add accessories: \`hair_ribbon\`, \`glasses\`, \`hat\`
7. Add pose/action: \`standing\`, \`sitting\`, \`looking_at_viewer\`
8. Add background: \`simple_background\`, \`outdoors\`, \`classroom\`

## ⚠️ IMPORTANT
- ALWAYS use \`validate_danbooru_tags\` to verify tags before using them in prompts
- Use \`search_danbooru_tags\` to find the correct tag when unsure
- Use \`get_popular_danbooru_tags\` with \`group_by_semantic=true\` for reference
`

      if (Object.keys(groups).length > 0) {
        guideText += '\n## Popular Tags by Category\n'
        for (const [group, tags] of Object.entries(groups)) {
          if (tags.length > 0) {
            const displayName = group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            guideText += `\n### ${displayName}\n\`${tags.slice(0, 20).join(', ')}\`\n`
          }
        }
      }

      if (character_description) {
        guideText += `\n## Your Character Description\n"${character_description}"\n\nPlease use the tags above and the \`search_danbooru_tags\` tool to find appropriate tags for this character. Validate all tags with \`validate_danbooru_tags\` before creating the module item.\n`
      }

      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: guideText }
        }]
      }
    }
  )
}
