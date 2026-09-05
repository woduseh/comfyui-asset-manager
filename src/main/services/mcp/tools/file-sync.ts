import { jsonError, jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'
import { parseModuleItemsFile } from '../file-parser'
import type { ParsedModuleItem } from '../file-parser'
import { writeModuleItemsFile } from '../file-serializer'
import { diffModuleWithItems } from '../diff-engine'
import { validatePromptVariants } from '../../../ipc/validators'

function toParsedModuleItem(item: Record<string, unknown>): ParsedModuleItem {
  const variants = validatePromptVariants(item.prompt_variants)
  return {
    name: (item.name as string) || '',
    prompt: (item.prompt as string) || '',
    negative: (item.negative as string) || undefined,
    prompt_variants: Object.keys(variants).length ? variants : undefined
  }
}

export function registerFileSyncTools(server: McpServer): void {
  // === Export / Diff / Sync ===

  server.tool(
    'export_module_items_to_file',
    'Export module items to a file (JSON/CSV/Markdown). Format auto-detected from extension if omitted.',
    {
      module_id: z.string().describe('Module ID'),
      file_path: z.string().describe('Absolute path for the output file'),
      format: z
        .enum(['json', 'csv', 'md'])
        .optional()
        .describe('Output format (auto-detected from extension if omitted)')
    },
    async ({ module_id, file_path, format }) => {
      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return jsonError('Module not found')
      }

      const items = moduleItemRepo.list(module_id)
      const parsedItems: ParsedModuleItem[] = items.map(toParsedModuleItem)

      try {
        const result = writeModuleItemsFile(parsedItems, file_path, format)
        return jsonResult({
          file_path: result.filePath,
          format: result.format,
          items_exported: parsedItems.length,
          file_size_bytes: result.size,
          module_name: mod.name
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return jsonError(msg)
      }
    }
  )

  server.tool(
    'diff_module_with_file',
    'Compare module items with an external file (JSON/CSV/Markdown). Shows added, removed, and modified items with tag-level diffs.',
    {
      module_id: z.string().describe('Module ID to compare'),
      file_path: z.string().describe('Absolute path to the comparison file'),
      format: z
        .enum(['json', 'csv', 'md'])
        .optional()
        .describe('File format (auto-detected from extension if omitted)')
    },
    async ({ module_id, file_path, format }) => {
      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return jsonError('Module not found')
      }

      let parseResult
      try {
        parseResult = parseModuleItemsFile(file_path, format)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return jsonError(msg)
      }

      const items = moduleItemRepo.list(module_id)
      const moduleItems = items.map((item) => ({
        id: item.id as string,
        ...toParsedModuleItem(item)
      }))

      const diff = diffModuleWithItems(moduleItems, parseResult.items)

      return jsonResult({
        module_name: mod.name,
        file_path,
        format: parseResult.format,
        parse_errors: parseResult.errors,
        summary: diff.summary,
        added: diff.added.map((i) => ({
          name: i.name,
          prompt_preview: i.prompt.substring(0, 80)
        })),
        removed: diff.removed.map((i) => ({
          name: i.name,
          prompt_preview: i.prompt.substring(0, 80)
        })),
        modified: diff.modified.map((m) => ({
          name: m.name,
          module_item_id: m.module_item_id,
          added_tags: m.prompt_diff.added_tags,
          removed_tags: m.prompt_diff.removed_tags,
          negative_changed: !!m.negative_diff,
          variants_changed: m.variants_changed
        }))
      })
    }
  )

  server.tool(
    'sync_module_from_file',
    'Synchronize module items with an external file (upsert). Matches by name: updates existing, creates new, optionally deletes missing. Use dry_run=true to preview.',
    {
      module_id: z.string().describe('Module ID to sync'),
      file_path: z.string().describe('Absolute path to the source file'),
      format: z
        .enum(['json', 'csv', 'md'])
        .optional()
        .describe('File format (auto-detected from extension if omitted)'),
      dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, preview changes without applying'),
      delete_missing: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, delete module items not present in the file')
    },
    async ({ module_id, file_path, format, dry_run, delete_missing }) => {
      const mod = moduleRepo.get(module_id)
      if (!mod) {
        return jsonError('Module not found')
      }

      let parseResult
      try {
        parseResult = parseModuleItemsFile(file_path, format)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return jsonError(msg)
      }

      const items = moduleItemRepo.list(module_id)
      const moduleItems = items.map((item) => ({
        id: item.id as string,
        ...toParsedModuleItem(item)
      }))

      const diff = diffModuleWithItems(moduleItems, parseResult.items)

      if (dry_run) {
        return jsonResult({
          dry_run: true,
          summary: {
            ...diff.summary,
            will_create: diff.added.length,
            will_update: diff.modified.length,
            will_delete: delete_missing ? diff.removed.length : 0
          },
          to_create: diff.added.map((i) => ({ name: i.name })),
          to_update: diff.modified.map((m) => ({
            name: m.name,
            added_tags: m.prompt_diff.added_tags.length,
            removed_tags: m.prompt_diff.removed_tags.length
          })),
          to_delete: delete_missing ? diff.removed.map((i) => ({ name: i.name })) : []
        })
      }

      // Apply changes
      let created = 0
      let updated = 0
      let deleted = 0
      const errors: Array<{ action: string; name: string; error: string }> = []

      // Create new items
      if (diff.added.length > 0) {
        const newItems = diff.added.map((item, index) => ({
          module_id,
          name: item.name,
          prompt: item.prompt,
          negative: item.negative,
          sort_order: items.length + index,
          prompt_variants: item.prompt_variants ? JSON.stringify(item.prompt_variants) : undefined
        }))
        const result = moduleItemRepo.bulkCreate(newItems)
        created = result.succeeded
        for (const err of result.errors) {
          errors.push({
            action: 'create',
            name: diff.added[err.index]?.name || '',
            error: err.error
          })
        }
      }

      // Update modified items
      if (diff.modified.length > 0) {
        const updates = diff.modified
          .filter((m) => m.module_item_id)
          .map((m) => {
            const fileItem = parseResult.items.find(
              (fi) => fi.name.trim().toLowerCase() === m.name.trim().toLowerCase()
            )
            if (!fileItem) return null
            const data: Record<string, unknown> = { prompt: fileItem.prompt }
            if (fileItem.negative !== undefined) data.negative = fileItem.negative
            if (fileItem.prompt_variants) {
              data.prompt_variants = JSON.stringify(fileItem.prompt_variants)
            }
            return { id: m.module_item_id!, data }
          })
          .filter((u): u is { id: string; data: Record<string, unknown> } => u !== null)

        const result = moduleItemRepo.bulkUpdate(updates)
        updated = result.succeeded
        for (const err of result.errors) {
          errors.push({ action: 'update', name: err.id, error: err.error })
        }
      }

      // Delete missing items
      if (delete_missing && diff.removed.length > 0) {
        for (const item of diff.removed) {
          try {
            const id = (item as { id?: string }).id
            if (id) {
              moduleItemRepo.delete(id)
              deleted++
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            errors.push({ action: 'delete', name: item.name, error: msg })
          }
        }
      }

      return jsonResult({
        dry_run: false,
        summary: diff.summary,
        created,
        updated,
        deleted,
        errors
      })
    }
  )
}
