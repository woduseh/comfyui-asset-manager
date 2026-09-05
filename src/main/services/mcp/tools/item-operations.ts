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
    'update_module_items',
    `Update one or more module items; pass an array of one for a single edit. Max ${MAX_BULK_UPDATE_ITEMS} items per request. Each item requires an id and at least one field to update. Returns succeeded/failed counts and per-ID errors; partial success is possible, so inspect errors and retry only failed items. prompt_variants replaces all named variants. Missing IDs are reported as failures.`,
    {
      items: z
        .array(
          z
            .object({
              id: z.string().min(1).describe('Item ID'),
              name: z.string().trim().min(1).optional().describe('New name'),
              prompt: z
                .string()
                .optional()
                .describe(
                  'Composed text: positive for ordinary modules, exclusions for negative-type modules'
                ),
              negative: z
                .string()
                .optional()
                .describe(
                  'Stored auxiliary field; batch composition does not use it. Put exclusions in the prompt of a negative-type module item.'
                ),
              weight: z.number().finite().optional().describe('New weight'),
              enabled: z
                .boolean()
                .optional()
                .describe('Whether this item participates in generation'),
              prompt_variants: z
                .record(
                  z.string(),
                  z.object({
                    prompt: z.string(),
                    negative: z
                      .string()
                      .describe(
                        'Auxiliary field, not composed. For a negative-type module put exclusions in variant.prompt.'
                      )
                  })
                )
                .optional()
                .describe('Named prompt variants')
            })
            .refine(
              (item) =>
                Object.keys(item).some(
                  (key) => key !== 'id' && item[key as keyof typeof item] !== undefined
                ),
              'Provide at least one field to update'
            )
        )
        .min(1)
        .max(MAX_BULK_UPDATE_ITEMS)
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
        if (item.enabled !== undefined) data.enabled = item.enabled ? 1 : 0
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
      variant_names: z
        .array(z.string())
        .optional()
        .describe(
          'Restrict variant edits to these names; use tags to leave natural-language variants unchanged'
        ),
      include_default: z
        .boolean()
        .optional()
        .describe('Edit default prompt and negative too (default: true)'),
      dry_run: z.boolean().optional().describe('Preview changes without applying (default: false)')
    },
    async ({
      module_id,
      old_tag,
      new_tag,
      include_variants,
      variant_names,
      include_default,
      dry_run
    }) => {
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

        const newPrompt =
          include_default === false ? prompt : replaceTagInPrompt(prompt, old_tag, new_tag)
        if (newPrompt !== prompt) {
          changes.push({ field: 'prompt', before: prompt, after: newPrompt })
          data.prompt = newPrompt
        }

        const newNegative =
          include_default === false ? negative : replaceTagInPrompt(negative, old_tag, new_tag)
        if (newNegative !== negative) {
          changes.push({ field: 'negative', before: negative, after: newNegative })
          data.negative = newNegative
        }

        if (applyVariants) {
          const variants = validatePromptVariants(item.prompt_variants)
          let variantChanged = false
          const newVariants = { ...variants }

          for (const [variantName, variant] of Object.entries(variants)) {
            if (variant_names && !variant_names.includes(variantName)) continue
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

      const result =
        !isDryRun && updates.length > 0
          ? moduleItemRepo.bulkUpdate(updates)
          : { succeeded: 0, failed: 0, errors: [] }

      return jsonResult({
        dry_run: isDryRun,
        total_items: items.length,
        matched_items: modifications.length,
        modified_items: isDryRun ? 0 : result.succeeded,
        succeeded: result.succeeded,
        failed: result.failed,
        errors: result.errors,
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
        .describe('Also validate selected prompt variants (default: true; tags variant only)'),
      variant_names: z
        .array(z.string())
        .optional()
        .describe(
          'Validate only these variants (default: tags). Natural-language variants should be excluded.'
        ),
      include_default: z
        .boolean()
        .optional()
        .describe(
          'Validate default prompts too (default: true). Set false for natural-language defaults.'
        ),
      online_fallback: z
        .boolean()
        .optional()
        .describe('Check Danbooru API for tags not found locally (default: true)')
    },
    async ({ module_id, include_variants, variant_names, include_default, online_fallback }) => {
      const applyVariants = include_variants !== false
      const useOnline = online_fallback !== false

      if (!tagService.isLoaded()) {
        tagService.load()
        if (!tagService.isLoaded()) {
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
        const fields: Array<{ field: string; text: string }> =
          include_default === false
            ? []
            : [
                { field: 'prompt', text: (item.prompt as string) || '' },
                { field: 'negative', text: (item.negative as string) || '' }
              ]

        if (applyVariants) {
          const variants = validatePromptVariants(item.prompt_variants)
          for (const [vName, v] of Object.entries(variants)) {
            if (!(variant_names ?? ['tags']).includes(vName)) continue
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
}
