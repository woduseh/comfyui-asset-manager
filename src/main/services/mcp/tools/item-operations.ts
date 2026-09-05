import { jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleItemRepo } from './shared'
import { tagService } from '../../tags'
import { replaceTagInPrompt, extractTagsFromPrompt } from '../../tags/utils'
import { validatePromptVariants } from '../../../ipc/validators'
import { MAX_BULK_UPDATE_ITEMS } from '../../../constants'

export function registerItemOperationTools(server: McpServer): void {
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
      return jsonResult({
        total: items.length,
        succeeded: result.succeeded,
        failed: result.failed,
        errors: result.errors
      })
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

      return jsonResult({
        dry_run: isDryRun,
        total_items: items.length,
        modified_items: modifications.length,
        modifications
      })
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

      return jsonResult({
        total_items: items.length,
        total_unique_tags: uniqueTags.length,
        summary: { valid: validCount, invalid: invalidCount, unverified: unverifiedCount },
        online_available: onlineAvailable,
        local_tag_count: tagService.getTagCount(),
        issues
      })
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

      return jsonResult({ total: matches.length, matches })
    }
  )
}
