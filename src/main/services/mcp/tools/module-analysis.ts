import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { moduleRepo, moduleItemRepo } from './shared'

export function registerModuleAnalysisTools(server: McpServer): void {
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
}
