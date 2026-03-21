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
import { replaceTagInPrompt, extractTagsFromPrompt } from '../tags/utils'
import { parseModuleItemsFile } from './file-parser'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { validatePromptVariants } from '../../ipc/validators'
import {
  MAX_BULK_UPDATE_ITEMS,
  MAX_LIST_ITEMS_LIMIT,
  MAX_IMPORT_FILE_SIZE_BYTES
} from '../../constants'

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
      type: z
        .enum([
          'character',
          'outfit',
          'emotion',
          'style',
          'artist',
          'quality',
          'negative',
          'lora',
          'custom'
        ])
        .describe('Module type'),
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
    'List all items in a prompt module. Supports pagination with limit/offset for large modules.',
    {
      module_id: z.string().describe('Module ID'),
      limit: z
        .number()
        .optional()
        .describe(`Max items to return (default: all, max: ${MAX_LIST_ITEMS_LIMIT})`),
      offset: z.number().optional().describe('Number of items to skip (default: 0)')
    },
    async ({ module_id, limit, offset }) => {
      const total = moduleItemRepo.count(module_id)
      const effectiveLimit = limit !== undefined ? Math.min(limit, MAX_LIST_ITEMS_LIMIT) : undefined
      const options =
        effectiveLimit !== undefined ? { limit: effectiveLimit, offset: offset ?? 0 } : undefined
      const items = moduleItemRepo.list(module_id, options)
      const response: Record<string, unknown> = { items, total }
      if (options) {
        response.limit = effectiveLimit
        response.offset = options.offset
        response.has_more = options.offset + items.length < total
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }]
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
      prompt_variants: z
        .record(
          z.string(),
          z.object({
            prompt: z.string().describe('Variant positive prompt'),
            negative: z.string().describe('Variant negative prompt')
          })
        )
        .optional()
        .describe(
          'Named prompt variants, e.g. {"natural_language": {prompt: "...", negative: "..."}, "tags": {prompt: "...", negative: "..."}}'
        )
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
      prompt_variants: z
        .record(
          z.string(),
          z.object({
            prompt: z.string().describe('Variant positive prompt'),
            negative: z.string().describe('Variant negative prompt')
          })
        )
        .optional()
        .describe('Named prompt variants (replaces all existing variants)')
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

  server.tool(
    'get_module_item',
    'Get a specific module item by ID, including its prompt variants.',
    { id: z.string().describe('Item ID') },
    async ({ id }) => {
      const item = moduleItemRepo.get(id)
      if (!item) {
        return {
          content: [{ type: 'text', text: `Module item not found: ${id}` }],
          isError: true
        }
      }
      if (typeof item.prompt_variants === 'string') {
        item.prompt_variants = validatePromptVariants(item.prompt_variants)
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(item, null, 2) }]
      }
    }
  )

  server.tool(
    'bulk_update_module_items',
    `Update multiple module items in a single call. Max ${MAX_BULK_UPDATE_ITEMS} items per request. Each item requires an id and at least one field to update. Supports prompt_variants for per-slot different prompts.`,
    {
      items: z
        .array(
          z.object({
            id: z.string().describe('Item ID'),
            name: z.string().optional().describe('New name'),
            prompt: z.string().optional().describe('New default prompt'),
            negative: z.string().optional().describe('New negative prompt'),
            weight: z.number().optional().describe('New weight'),
            prompt_variants: z
              .record(
                z.string(),
                z.object({
                  prompt: z.string(),
                  negative: z.string()
                })
              )
              .optional()
              .describe('Named prompt variants')
          })
        )
        .describe('Array of items to update')
    },
    async ({ items }) => {
      if (items.length > MAX_BULK_UPDATE_ITEMS) {
        return {
          content: [
            {
              type: 'text',
              text: `Too many items: ${items.length}. Maximum is ${MAX_BULK_UPDATE_ITEMS} per request.`
            }
          ],
          isError: true
        }
      }

      const updates = items.map((item) => {
        const data: Record<string, unknown> = {}
        if (item.name !== undefined) data.name = item.name
        if (item.prompt !== undefined) data.prompt = item.prompt
        if (item.negative !== undefined) data.negative = item.negative
        if (item.weight !== undefined) data.weight = item.weight
        if (item.prompt_variants !== undefined)
          data.prompt_variants = JSON.stringify(item.prompt_variants)
        return { id: item.id, data }
      })

      const result = moduleItemRepo.bulkUpdate(updates)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: items.length,
                succeeded: result.succeeded,
                failed: result.failed,
                errors: result.errors
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.tool(
    'replace_tag_in_module',
    'Replace or remove a specific tag across all items in a module. Matches exact tag names (not substrings). Works on default prompts and optionally on prompt variants. Use dry_run=true to preview changes before applying.',
    {
      module_id: z.string().describe('Module ID'),
      old_tag: z.string().describe('Tag to find (exact match, case-insensitive)'),
      new_tag: z.string().describe('Replacement tag (empty string to delete the tag)'),
      include_variants: z
        .boolean()
        .optional()
        .describe('Also replace in prompt_variants (default: true)'),
      dry_run: z.boolean().optional().describe('Preview changes without applying (default: false)')
    },
    async ({ module_id, old_tag, new_tag, include_variants, dry_run }) => {
      const applyVariants = include_variants !== false
      const isDryRun = dry_run === true
      const items = moduleItemRepo.list(module_id)

      const modifications: Array<{
        item_id: string
        item_name: string
        changes: Array<{ field: string; before: string; after: string }>
      }> = []
      const updates: Array<{ id: string; data: Record<string, unknown> }> = []

      for (const item of items) {
        const changes: Array<{ field: string; before: string; after: string }> = []
        const data: Record<string, unknown> = {}
        const prompt = (item.prompt as string) || ''
        const negative = (item.negative as string) || ''

        const newPrompt = replaceTagInPrompt(prompt, old_tag, new_tag)
        if (newPrompt !== prompt) {
          changes.push({ field: 'prompt', before: prompt, after: newPrompt })
          data.prompt = newPrompt
        }

        const newNegative = replaceTagInPrompt(negative, old_tag, new_tag)
        if (newNegative !== negative) {
          changes.push({ field: 'negative', before: negative, after: newNegative })
          data.negative = newNegative
        }

        if (applyVariants) {
          const variants = validatePromptVariants(item.prompt_variants)
          let variantChanged = false
          const newVariants = { ...variants }

          for (const [variantName, variant] of Object.entries(variants)) {
            const vp = replaceTagInPrompt(variant.prompt, old_tag, new_tag)
            const vn = replaceTagInPrompt(variant.negative, old_tag, new_tag)
            if (vp !== variant.prompt) {
              changes.push({
                field: `variant:${variantName}:prompt`,
                before: variant.prompt,
                after: vp
              })
              variantChanged = true
            }
            if (vn !== variant.negative) {
              changes.push({
                field: `variant:${variantName}:negative`,
                before: variant.negative,
                after: vn
              })
              variantChanged = true
            }
            newVariants[variantName] = { prompt: vp, negative: vn }
          }

          if (variantChanged) {
            data.prompt_variants = JSON.stringify(newVariants)
          }
        }

        if (changes.length > 0) {
          modifications.push({
            item_id: item.id as string,
            item_name: item.name as string,
            changes
          })
          if (Object.keys(data).length > 0) {
            updates.push({ id: item.id as string, data })
          }
        }
      }

      if (!isDryRun && updates.length > 0) {
        moduleItemRepo.bulkUpdate(updates)
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                dry_run: isDryRun,
                total_items: items.length,
                modified_items: modifications.length,
                modifications
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.tool(
    'validate_module_tags',
    "Validate all Danbooru tags in a module's items. Extracts tags from prompts, deduplicates, validates via local DB + optional online fallback, and reports issues per item with suggestions. Only items with problems are listed in issues.",
    {
      module_id: z.string().describe('Module ID'),
      include_variants: z
        .boolean()
        .optional()
        .describe('Also validate tags in prompt_variants (default: true)'),
      online_fallback: z
        .boolean()
        .optional()
        .describe('Check Danbooru API for tags not found locally (default: true)')
    },
    async ({ module_id, include_variants, online_fallback }) => {
      const applyVariants = include_variants !== false
      const useOnline = online_fallback !== false

      if (!tagService.isLoaded) {
        tagService.load()
        if (!tagService.isLoaded) {
          return {
            content: [
              {
                type: 'text',
                text: `Tag database not loaded. Error: ${tagService.lastError || 'unknown'}`
              }
            ],
            isError: true
          }
        }
      }

      const items = moduleItemRepo.list(module_id)

      // Collect all unique tags and track which items use them
      const tagToItems = new Map<
        string,
        Array<{ item_id: string; item_name: string; field: string }>
      >()

      for (const item of items) {
        const fields: Array<{ field: string; text: string }> = [
          { field: 'prompt', text: (item.prompt as string) || '' },
          { field: 'negative', text: (item.negative as string) || '' }
        ]

        if (applyVariants) {
          const variants = validatePromptVariants(item.prompt_variants)
          for (const [vName, v] of Object.entries(variants)) {
            fields.push({ field: `variant:${vName}:prompt`, text: v.prompt })
            fields.push({ field: `variant:${vName}:negative`, text: v.negative })
          }
        }

        for (const { field, text } of fields) {
          const tags = extractTagsFromPrompt(text)
          for (const tag of tags) {
            // Strip weight syntax for validation
            const raw = tag.replace(/^\(?\s*([^():]+?)\s*(?::[\d.]+)?\s*\)?$/, '$1').trim()
            if (!raw) continue
            const key = raw.toLowerCase()
            if (!tagToItems.has(key)) tagToItems.set(key, [])
            tagToItems.get(key)!.push({
              item_id: item.id as string,
              item_name: item.name as string,
              field
            })
          }
        }
      }

      const uniqueTags = Array.from(tagToItems.keys())
      const { results, onlineAvailable } = await tagService.validate(uniqueTags, useOnline)

      // Build issue map
      const issueMap = new Map<
        string,
        {
          item_id: string
          item_name: string
          fields: Map<string, Array<{ tag: string; suggestions?: string[] }>>
        }
      >()

      let validCount = 0
      let invalidCount = 0
      let unverifiedCount = 0

      for (const r of results) {
        if (r.valid === true) {
          validCount++
          continue
        }
        if (r.valid === null) {
          unverifiedCount++
          continue
        }
        invalidCount++

        const refs = tagToItems.get(r.tag.toLowerCase()) || []
        for (const ref of refs) {
          const key = `${ref.item_id}::${ref.field}`
          if (!issueMap.has(key)) {
            issueMap.set(key, {
              item_id: ref.item_id,
              item_name: ref.item_name,
              fields: new Map()
            })
          }
          const entry = issueMap.get(key)!
          if (!entry.fields.has(ref.field)) entry.fields.set(ref.field, [])
          entry.fields.get(ref.field)!.push({
            tag: r.tag,
            suggestions: r.suggestions
          })
        }
      }

      // Flatten to array
      const issues: Array<{
        item_id: string
        item_name: string
        field: string
        invalid_tags: Array<{ tag: string; suggestions?: string[] }>
      }> = []

      for (const entry of issueMap.values()) {
        for (const [field, tags] of entry.fields) {
          issues.push({
            item_id: entry.item_id,
            item_name: entry.item_name,
            field,
            invalid_tags: tags
          })
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total_items: items.length,
                total_unique_tags: uniqueTags.length,
                summary: { valid: validCount, invalid: invalidCount, unverified: unverifiedCount },
                online_available: onlineAvailable,
                local_tag_count: tagService.getTagCount(),
                issues
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.tool(
    'search_module_items',
    'Search for items within a module by text query. Matches item names, prompts, negatives, and optionally prompt variants. Case-insensitive substring match.',
    {
      module_id: z.string().describe('Module ID'),
      query: z.string().describe('Search text (case-insensitive substring match)'),
      field: z
        .enum(['prompt', 'negative', 'name', 'all'])
        .optional()
        .describe('Field to search in (default: all)'),
      include_variants: z
        .boolean()
        .optional()
        .describe('Also search in prompt_variants (default: true)')
    },
    async ({ module_id, query, field, include_variants }) => {
      const searchField = field || 'all'
      const applyVariants = include_variants !== false
      const items = moduleItemRepo.list(module_id)
      const q = query.toLowerCase()

      const matches: Array<{
        id: string
        name: string
        prompt: string
        negative: string
        matched_fields: string[]
      }> = []

      for (const item of items) {
        const matchedFields: string[] = []
        const name = (item.name as string) || ''
        const prompt = (item.prompt as string) || ''
        const negative = (item.negative as string) || ''

        if ((searchField === 'all' || searchField === 'name') && name.toLowerCase().includes(q)) {
          matchedFields.push('name')
        }
        if (
          (searchField === 'all' || searchField === 'prompt') &&
          prompt.toLowerCase().includes(q)
        ) {
          matchedFields.push('prompt')
        }
        if (
          (searchField === 'all' || searchField === 'negative') &&
          negative.toLowerCase().includes(q)
        ) {
          matchedFields.push('negative')
        }

        if (applyVariants) {
          const variants = validatePromptVariants(item.prompt_variants)
          for (const [vName, v] of Object.entries(variants)) {
            if (v.prompt.toLowerCase().includes(q)) {
              matchedFields.push(`variant:${vName}:prompt`)
            }
            if (v.negative.toLowerCase().includes(q)) {
              matchedFields.push(`variant:${vName}:negative`)
            }
          }
        }

        if (matchedFields.length > 0) {
          matches.push({
            id: item.id as string,
            name,
            prompt,
            negative,
            matched_fields: matchedFields
          })
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ total: matches.length, matches }, null, 2)
          }
        ]
      }
    }
  )

  // === Bulk Create ===

  server.tool(
    'bulk_create_module_items',
    `Create multiple module items at once (max ${MAX_BULK_UPDATE_ITEMS}). Returns created IDs and error details.`,
    {
      module_id: z.string().describe('Module ID'),
      items: z
        .array(
          z.object({
            name: z.string().describe('Item name'),
            prompt: z.string().describe('Positive prompt text'),
            negative: z.string().optional().describe('Negative prompt text'),
            weight: z.number().optional().describe('Weight (default: 1.0)'),
            prompt_variants: z
              .record(
                z.string(),
                z.object({
                  prompt: z.string(),
                  negative: z.string()
                })
              )
              .optional()
              .describe('Named prompt variants')
          })
        )
        .describe('Array of items to create')
    },
    async ({ module_id, items }) => {
      if (items.length > MAX_BULK_UPDATE_ITEMS) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Too many items: ${items.length}. Maximum: ${MAX_BULK_UPDATE_ITEMS}`
              })
            }
          ],
          isError: true
        }
      }

      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Module not found' }) }],
          isError: true
        }
      }

      const preparedItems = items.map((item, index) => ({
        module_id,
        name: item.name,
        prompt: item.prompt,
        negative: item.negative,
        weight: item.weight,
        sort_order: index,
        prompt_variants: item.prompt_variants ? JSON.stringify(item.prompt_variants) : undefined
      }))

      const result = moduleItemRepo.bulkCreate(preparedItems)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total: items.length,
                succeeded: result.succeeded,
                failed: result.failed,
                ids: result.ids,
                errors: result.errors
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  // === File Import ===

  server.tool(
    'import_module_items_from_file',
    `Import module items from a file (JSON/CSV/Markdown). Max file size: ${MAX_IMPORT_FILE_SIZE_BYTES / 1024}KB. Use dry_run=true to preview without saving.`,
    {
      module_id: z.string().describe('Module ID to import items into'),
      file_path: z.string().describe('Absolute path to the import file'),
      format: z
        .enum(['json', 'csv', 'md'])
        .optional()
        .describe('File format (auto-detected from extension if omitted)'),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, parse and preview only without saving')
    },
    async ({ module_id, file_path, format, dry_run }) => {
      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Module not found' }) }],
          isError: true
        }
      }

      let parseResult
      try {
        parseResult = parseModuleItemsFile(file_path, format)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: msg }) }],
          isError: true
        }
      }

      const preview = parseResult.items.slice(0, 10).map((item) => ({
        name: item.name,
        prompt_preview: item.prompt.substring(0, 80) + (item.prompt.length > 80 ? '...' : '')
      }))

      if (dry_run) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  dry_run: true,
                  file_path,
                  format: parseResult.format,
                  total_parsed: parseResult.items.length,
                  succeeded: 0,
                  failed: 0,
                  items_preview: preview,
                  parse_errors: parseResult.errors
                },
                null,
                2
              )
            }
          ]
        }
      }

      const preparedItems = parseResult.items.map((item, index) => ({
        module_id,
        name: item.name,
        prompt: item.prompt,
        negative: item.negative,
        sort_order: index,
        prompt_variants: item.prompt_variants ? JSON.stringify(item.prompt_variants) : undefined
      }))

      const result = moduleItemRepo.bulkCreate(preparedItems)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                dry_run: false,
                file_path,
                format: parseResult.format,
                total_parsed: parseResult.items.length,
                succeeded: result.succeeded,
                failed: result.failed,
                ids: result.ids,
                items_preview: preview,
                parse_errors: parseResult.errors,
                create_errors: result.errors
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  // === Module Duplication ===

  server.tool(
    'duplicate_module',
    'Duplicate a module and all its items with a new name.',
    {
      module_id: z.string().describe('Source module ID to duplicate'),
      new_name: z.string().describe('Name for the duplicated module')
    },
    async ({ module_id, new_name }) => {
      const result = moduleRepo.duplicate(module_id, new_name)
      if (!result) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Source module not found' }) }],
          isError: true
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                source_module_id: module_id,
                new_module_id: result.newModuleId,
                new_name,
                items_copied: result.itemsCopied
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  // === Module Stats ===

  server.tool(
    'get_module_stats',
    'Get summary statistics for a specific module or all modules. Returns item counts, variant info, and prompt length stats.',
    {
      module_id: z.string().optional().describe('Module ID (omit for all modules summary)')
    },
    async ({ module_id }) => {
      function getModuleStats(mod: Record<string, unknown>): Record<string, unknown> {
        const items = moduleItemRepo.list(mod.id as string)
        const enabledItems = items.filter((i) => (i.weight as number) > 0)
        let hasVariants = false
        let totalPromptLen = 0

        for (const item of items) {
          totalPromptLen += ((item.prompt as string) || '').length
          const variantsStr = item.prompt_variants as string
          if (variantsStr && variantsStr !== '{}') {
            hasVariants = true
          }
        }

        return {
          module_id: mod.id,
          name: mod.name,
          type: mod.type,
          total_items: items.length,
          enabled_items: enabledItems.length,
          disabled_items: items.length - enabledItems.length,
          has_variants: hasVariants,
          avg_prompt_length: items.length > 0 ? Math.round(totalPromptLen / items.length) : 0
        }
      }

      if (module_id) {
        const mod = moduleRepo.get(module_id)
        if (!mod) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Module not found' }) }],
            isError: true
          }
        }
        const stats = getModuleStats(mod)
        return {
          content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
        }
      }

      const modules = moduleRepo.list()
      const moduleStats = modules.map(getModuleStats)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                total_modules: modules.length,
                modules: moduleStats
              },
              null,
              2
            )
          }
        ]
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

  // === Danbooru Tag Tools ===

  server.tool(
    'validate_danbooru_tags',
    'Validate whether given tags are valid Danbooru tags. Returns validation result for each tag with suggestions for invalid ones. IMPORTANT: Always use this tool to verify your tags before creating module items with prompts. Local DB has ~6500 popular tags. Tags not found locally are checked via Danbooru API if online_fallback is true. If the API is unreachable, unknown tags are marked as "unverified" (valid=null) instead of invalid.',
    {
      tags: z
        .array(z.string())
        .describe('List of tags to validate (e.g. ["blue_eyes", "long_hair", "school_uniform"])'),
      online_fallback: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true, check Danbooru API for tags not found locally (default: true). Set to false in offline environments to skip network checks entirely.'
        )
    },
    async ({ tags, online_fallback }) => {
      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
          const detail = tagService.lastError ? ` (${tagService.lastError})` : ''
          return {
            content: [
              { type: 'text', text: `Tag database not loaded${detail}. Please check the log.` }
            ],
            isError: true
          }
        }
      }

      const { results, onlineAvailable } = await tagService.validate(tags, online_fallback)
      const validCount = results.filter((r) => r.valid === true).length
      const invalidCount = results.filter((r) => r.valid === false).length
      const unverifiedCount = results.filter((r) => r.valid === null).length

      let summary = `${validCount}/${tags.length} tags valid`
      if (invalidCount > 0) summary += `, ${invalidCount} invalid`
      if (unverifiedCount > 0)
        summary += `, ${unverifiedCount} unverified (not in local DB, online unavailable)`

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                summary,
                online_available: onlineAvailable,
                local_tag_count: tagService.getTagCount(),
                results
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.tool(
    'search_danbooru_tags',
    'Search for Danbooru tags matching a query. Use this to find the correct tag name for a concept. Supports wildcard (*) patterns. Results are sorted by popularity (post count). Searches local DB (~6500 tags) first, supplements with Danbooru API if reachable. Works fully offline with local results only.',
    {
      query: z
        .string()
        .describe('Search query (e.g. "blue_eye", "long_h*", "school"). Supports * wildcard.'),
      category: z
        .enum(['general', 'artist', 'copyright', 'character', 'meta'])
        .optional()
        .describe('Filter by tag category'),
      limit: z.number().optional().default(20).describe('Max results (default: 20, max: 50)')
    },
    async ({ query, category, limit }) => {
      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
          const detail = tagService.lastError ? ` (${tagService.lastError})` : ''
          return {
            content: [
              { type: 'text', text: `Tag database not loaded${detail}. Please check the log.` }
            ],
            isError: true
          }
        }
      }

      const clampedLimit = Math.min(limit ?? 20, 50)
      const results = await tagService.searchWithOnline(query, category, clampedLimit)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                query,
                count: results.length,
                tags: tagService.formatTagsForDisplay(results)
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  server.tool(
    'get_popular_danbooru_tags',
    'Get popular Danbooru tags sorted by usage count. Use group_by_semantic=true to get tags organized by category (hair, eyes, clothing, pose, etc.) — very useful when writing character prompts. Uses local DB only — works fully offline.',
    {
      category: z
        .enum(['general', 'artist', 'copyright', 'character', 'meta'])
        .optional()
        .describe('Filter by tag category (most character-related tags are "general")'),
      limit: z
        .number()
        .optional()
        .default(100)
        .describe('Max results per group or total (default: 100, max: 500)'),
      group_by_semantic: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, returns tags grouped by semantic category (hair_color, eye_color, clothing, pose, etc.)'
        )
    },
    async ({ category, limit, group_by_semantic }) => {
      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
          const detail = tagService.lastError ? ` (${tagService.lastError})` : ''
          return {
            content: [
              { type: 'text', text: `Tag database not loaded${detail}. Please check the log.` }
            ],
            isError: true
          }
        }
      }

      if (group_by_semantic) {
        const groups = tagService.getPopularGrouped()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  description:
                    'Popular Danbooru tags grouped by semantic category. Use these as reference when writing prompts.',
                  groups
                },
                null,
                2
              )
            }
          ]
        }
      }

      const clampedLimit = Math.min(limit ?? 100, 500)
      const results = tagService.getPopular(category, clampedLimit)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: results.length,
                tags: tagService.formatTagsForDisplay(results)
              },
              null,
              2
            )
          }
        ]
      }
    }
  )

  // === Danbooru Tag Prompt Template ===

  server.prompt(
    'danbooru_tag_guide',
    'Guidelines and reference for writing image generation prompts using Danbooru tags. Call this before creating character prompts to get the correct tag format and popular tags.',
    {
      character_description: z
        .string()
        .optional()
        .describe('Optional character description for context-aware guidance')
    },
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
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: guideText }
          }
        ]
      }
    }
  )
}
