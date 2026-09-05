import { jsonError, jsonResult } from './response'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'
import { parseModuleItemsFile } from '../file-parser'
import type { ParsedModuleItem } from '../file-parser'
import { writeModuleItemsFile } from '../file-serializer'
import { diffModuleWithItems } from '../diff-engine'
import { validatePromptVariants } from '../../../ipc/validators'
import { withTransaction } from '../../database'

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
    'Export module items to a new file (JSON/CSV/Markdown). Existing destination files are preserved; choose a different path if one already exists. Format auto-detected from extension if omitted.',
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

      if (parseResult.errors.length > 0) {
        return {
          ...jsonResult({
            error: 'Source file has parse errors; comparison is unavailable until they are fixed.',
            parse_errors: parseResult.errors
          }),
          isError: true
        }
      }

      const items = moduleItemRepo.list(module_id)
      const moduleItems = items.map((item) => ({
        id: item.id as string,
        ...toParsedModuleItem(item)
      }))

      let diff
      try {
        diff = diffModuleWithItems(moduleItems, parseResult.items)
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : String(error))
      }

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
    'Synchronize module items atomically from JSON/CSV/Markdown. Matches unique names ignoring case/outer whitespace. Omitted negative and prompt_variants preserve existing values; use an empty string or empty object to clear them. Parse errors or ambiguous names block all writes. Use dry_run=true to preview; delete_missing=true also deletes absent items.',
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

      if (parseResult.errors.length > 0) {
        return {
          ...jsonResult({
            error:
              'Source file has parse errors; no changes were applied. Fix all parse_errors before retrying.',
            dry_run: !!dry_run,
            parse_errors: parseResult.errors,
            created: 0,
            updated: 0,
            deleted: 0
          }),
          isError: true
        }
      }

      const items = moduleItemRepo.list(module_id)
      const moduleItems = items.map((item) => ({
        id: item.id as string,
        ...toParsedModuleItem(item)
      }))

      let diff
      try {
        diff = diffModuleWithItems(moduleItems, parseResult.items)
      } catch (error) {
        return jsonError(error instanceof Error ? error.message : String(error))
      }

      if (dry_run) {
        return jsonResult({
          dry_run: true,
          parse_errors: parseResult.errors,
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

      try {
        withTransaction(() => {
          // Create new items
          if (diff.added.length > 0) {
            const newItems = diff.added.map((item, index) => ({
              module_id,
              name: item.name,
              prompt: item.prompt,
              negative: item.negative,
              sort_order: items.length + index,
              prompt_variants: item.prompt_variants
                ? JSON.stringify(item.prompt_variants)
                : undefined
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
            if (result.failed > 0) throw new Error('Creating source items failed')
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
            if (result.failed > 0) throw new Error('Updating source items failed')
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
                throw e
              }
            }
          }
        })
      } catch (error) {
        return {
          ...jsonResult({
            error: error instanceof Error ? error.message : String(error),
            dry_run: false,
            rolled_back: true,
            created: 0,
            updated: 0,
            deleted: 0,
            parse_errors: parseResult.errors,
            errors
          }),
          isError: true
        }
      }

      return jsonResult({
        dry_run: false,
        summary: diff.summary,
        created,
        updated,
        deleted,
        parse_errors: parseResult.errors,
        errors
      })
    }
  )
}
