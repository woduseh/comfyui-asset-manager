import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'
import { parseModuleItemsFile } from '../file-parser'
import { MAX_IMPORT_FILE_SIZE_BYTES } from '../../../constants'

export function registerFileImportTools(server: McpServer): void {
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
}
